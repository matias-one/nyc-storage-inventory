// bulk.js — Batch import Dataset A (supplier text) → Supabase inventory
const BULK_CHUNK_SIZE = 500;
const DATASET_A_HEADER_COUNT = 17;
let pendingBulkPayload = null;
let pendingBulkMeta = null;

// ============================================================
// 1. Parser — faithful port of GAS parseDatasetA / parseMultiLineRecordA
// ============================================================
function parseDatasetA(text) {
  const allLines = text.split("\n");
  let startIndex = -1, endIndex = -1;

  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i].includes("D/C")) { startIndex = i + 1; break; }
  }
  if (startIndex === -1) throw new Error("Dataset A format not detected — no 'D/C' header found.");

  for (let i = startIndex; i < allLines.length; i++) {
    if (allLines[i].includes("<<")) { endIndex = i; break; }
  }

  const lastIndex = endIndex === -1 ? allLines.length : endIndex;
  const dataLines = allLines.slice(startIndex, lastIndex);

  const lines = dataLines
    .map(l => l.trim())
    .filter(l => l !== "" && !l.includes("Total Items Listed :"));

  const records = [];
  let recordLines = [];
  for (const line of lines) {
    const isNewRecordStart = /^\d{1,3}\s+([\w\d\-\/]+)\s*$/.test(line);
    if (isNewRecordStart && recordLines.length > 0) {
      records.push(recordLines);
      recordLines = [line];
    } else {
      recordLines.push(line);
    }
  }
  if (recordLines.length > 0) records.push(recordLines);

  if (records.length === 0) {
    throw new Error("No product records found. Each record must start with a number (1-500) followed by the item number.");
  }

  return records.map(r => parseMultiLineRecordA(r));
}

function parseMultiLineRecordA(recordLines) {
  const cells = new Array(DATASET_A_HEADER_COUNT).fill("");
  let tempLines = [...recordLines];

  // Strip copyright noise
  tempLines = tempLines.filter(l => !/©Copyright/i.test(l));

  // Extract barcode (line of 8+ digits, optionally prefixed by "Unit Barcode")
  let barcodeValue = "";
  const cleaned = [];
  for (const line of tempLines) {
    const noLabel = line.replace(/Unit Barcode/i, "").trim();
    const bcMatch = noLabel.match(/^(\d{8,})$/);
    if (bcMatch) barcodeValue = bcMatch[1];
    else if (noLabel) cleaned.push(noLabel);
  }
  tempLines = cleaned;
  cells[3] = barcodeValue;

  // First line: "<list#> <sku>"
  const firstMatch = tempLines[0].match(/^(\d{1,3})\s+([\w\d\-\/]+)/);
  if (firstMatch) {
    cells[0] = firstMatch[1].trim();
    cells[1] = firstMatch[2].trim();
    tempLines.shift();
  } else {
    cells[0] = "PARSE_ERROR";
    cells[1] = recordLines[0].trim();
    tempLines.shift();
  }

  // ETA + reorder lines
  const etaEntries = [], reorderEntries = [], removeIdx = [];
  for (let i = 0; i < tempLines.length; i++) {
    const etaMatch = tempLines[i].match(/^ETA:\s*(.*)/i);
    const reorderMatch = tempLines[i].match(/(#[\d\w]+\s+Cs Ord:\s*\d+)/i);
    if (etaMatch) { etaEntries.push(etaMatch[1].trim()); removeIdx.push(i); }
    else if (reorderMatch) { reorderEntries.push(reorderMatch[1]); removeIdx.push(i); }
  }
  for (let i = removeIdx.length - 1; i >= 0; i--) tempLines.splice(removeIdx[i], 1);
  if (etaEntries.length) cells[11] = etaEntries.join(" | ");
  if (reorderEntries.length) cells[12] = reorderEntries.join(" | ");

  // Status lines
  let status1 = "", status2 = "", isOnSale = false;
  const statusIdx = [];
  for (let i = 0; i < tempLines.length; i++) {
    const l = tempLines[i].trim().toLowerCase();
    if (l === "out of stock") { status1 = "Out Of Stock"; statusIdx.push(i); }
    else if (l === "on sale" || l === "clearance") { status2 = tempLines[i].trim(); isOnSale = true; statusIdx.push(i); }
  }
  for (let i = statusIdx.length - 1; i >= 0; i--) tempLines.splice(statusIdx[i], 1);
  cells[9] = status1;
  cells[10] = status2;

  // Price lines (sale vs. non-sale branches — identical to GAS)
  if (isOnSale) {
    let priceLineIndex = -1, hasCategory = false;
    const priceLineRegex = /([A-Za-z\s\&\-\/\d\.]+)\s+(Yes|No)\s+\$?([\d\.,]+)\s*$/;
    for (let i = 0; i < tempLines.length; i++) {
      if (tempLines[i].match(priceLineRegex)) { priceLineIndex = i; hasCategory = true; break; }
    }
    if (priceLineIndex === -1) {
      const noCat = /^(Yes|No)\s+\$?([\d\.,]+)\s*$/;
      for (let i = 0; i < tempLines.length; i++) {
        if (tempLines[i].match(noCat)) { priceLineIndex = i; hasCategory = false; break; }
      }
    }
    if (priceLineIndex !== -1) {
      if (hasCategory) {
        const m = tempLines[priceLineIndex].match(priceLineRegex);
        cells[4] = m[1].trim().toUpperCase();
        cells[5] = m[2].trim();
        cells[6] = m[3].trim();
      } else {
        const m = tempLines[priceLineIndex].match(/^(Yes|No)\s+\$?([\d\.,]+)\s*$/);
        cells[4] = ""; cells[5] = m[1].trim(); cells[6] = m[2].trim();
      }
      if (priceLineIndex + 1 < tempLines.length) {
        const parts = tempLines[priceLineIndex + 1].trim().split(/\s+/);
        if (parts.length >= 5) {
          cells[7] = parts[0]; cells[8] = parts[1];
          cells[13] = parts[2]; cells[14] = parts[3]; cells[15] = parts[4];
        }
        tempLines.splice(priceLineIndex + 1, 1);
      }
      tempLines.splice(priceLineIndex, 1);
    }
  } else {
    const lastLineRegex = /([A-Z\s\&\-\/\d\.]+)\s+(Yes|No)\s+\$?([\d\.,]+)\s+\$?([\d\.,]+)\s+(Yes|No)\s+(Yes|No)\s+(Yes|No)\s*$/;
    let li = -1;
    for (let i = 0; i < tempLines.length; i++) {
      if (tempLines[i].match(lastLineRegex)) { li = i; break; }
    }
    if (li !== -1) {
      const m = tempLines[li].match(lastLineRegex);
      cells[4] = m[1].trim(); cells[5] = m[2].trim(); cells[6] = m[3].trim(); cells[8] = m[4].trim();
      cells[13] = m[5].trim(); cells[14] = m[6].trim(); cells[15] = m[7].trim();
      tempLines.splice(li, 1);
    } else {
      const noCat = /(Yes|No)\s+\$?([\d\.,]+)\s+\$?([\d\.,]+)\s+(Yes|No)\s+(Yes|No)\s+(Yes|No)\s*$/;
      for (let i = 0; i < tempLines.length; i++) {
        const m = tempLines[i].match(noCat);
        if (m) {
          cells[5] = m[1].trim(); cells[6] = m[2].trim(); cells[8] = m[3].trim();
          cells[13] = m[4].trim(); cells[14] = m[5].trim(); cells[15] = m[6].trim();
          tempLines.splice(i, 1);
          break;
        }
      }
    }
  }

  // Remaining lines = description
  cells[2] = tempLines.join(" ").trim();

  // Fallback category guess
  if (cells[4] === "" && cells[2] !== "") {
    const lower = cells[2].toLowerCase();
    if (lower.includes("bowl")) cells[4] = "BOWLS";
    else if (lower.includes("vase")) cells[4] = "VASES";
    else if (lower.includes("ribbon")) cells[4] = "RIBBONS";
  }

  return cells;
}



// ============================================================
// 1b. Shopify CSV parser
// ============================================================
const SHOPIFY_SUFFIX_REGEX = /-(bundle|case|pack|set|ea|ct|pk)$/i;

function parseShopifyCsv(csvText) {
  // Strip UTF-8 BOM (Shopify exports usually include it)
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const rows = parseCsvSimple(text);
  if (rows.length < 2) throw new Error("CSV is empty or missing header.");

  const headers = rows[0].map(h => h.trim());
  const getIdx = (name, required = true) => {
    const i = headers.indexOf(name);
    if (i === -1 && required) throw new Error(`CSV missing required header: "${name}"`);
    return i;
  };

  const iSku     = getIdx("Variant SKU");
  const iBarcode = getIdx("Variant Barcode", false);
  const iImage   = getIdx("Image Src", false);
  const iTitle   = getIdx("Title", false);
  const iOpt1    = getIdx("Option1 Value", false);
  const iOpt2    = getIdx("Option2 Value", false);
  const iOpt3    = getIdx("Option3 Value", false);

  const map = {};  // base SKU -> { barcode, image_url, description }
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawSku = String(row[iSku] || "").trim();
    if (!rawSku) continue;
    const baseSku = rawSku.replace(SHOPIFY_SUFFIX_REGEX, "");
    if (!baseSku || map[baseSku]) continue;  // first variant per base SKU wins

    const title = iTitle   >= 0 ? String(row[iTitle]   || "").trim() : "";
    const opt1  = iOpt1    >= 0 ? String(row[iOpt1]    || "").trim() : "";
    const opt2  = iOpt2    >= 0 ? String(row[iOpt2]    || "").trim() : "";
    const opt3  = iOpt3    >= 0 ? String(row[iOpt3]    || "").trim() : "";
    const opts  = [opt1, opt2, opt3].filter(v => v);
    const description = opts.length ? `${title} - ${opts.join(" / ")}` : title;

    map[baseSku] = {
      sku: baseSku,
      barcode:   iBarcode >= 0 ? String(row[iBarcode] || "").trim() : "",
      image_url: iImage   >= 0 ? String(row[iImage]   || "").trim() : "",
      description
    };
  }
  return Object.values(map);
}

// Minimal CSV parser — handles quoted fields, embedded commas/newlines
function parseCsvSimple(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== '\r') field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ============================================================
// 2. Map 17-cell row → Supabase inventory payload
// ============================================================
function rowToPayload(cells, supplierCode) {
  const sku = String(cells[1] || "").trim();
  if (!sku || cells[0] === "PARSE_ERROR") return null;

  const raw = {
    sku,
    description:  String(cells[2] || "").trim(),
    barcode:      String(cells[3] || "").trim(),
    category:     String(cells[4] || "").trim().toUpperCase(),
    stock:        String(cells[5] || "").trim(),
    status:       String(cells[10] || "").trim(),
    eta:          String(cells[11] || "").trim(),
    online:       String(cells[14] || "").trim(),
    discontinued: /^yes$/i.test(String(cells[15] || "").trim()) ? "Yes" : "No",
    supplier:     String(supplierCode || "").trim()
  };

  // Strip empties so we don't wipe good data; keep sku and discontinued always
  const clean = { sku: raw.sku, discontinued: raw.discontinued };
  for (const [k, v] of Object.entries(raw)) {
    if (k === "sku" || k === "discontinued") continue;
    if (v === "") continue;
    clean[k] = v;
  }
  return clean;
}

// ============================================================
// 3. Router — dispatches based on selected mode
// ============================================================
let pendingBulk = null;   // { mode: "dataset-a"|"shopify", ... }

async function bulkPreview() {
  const mode = document.getElementById("bulk-mode")?.value || "dataset-a";
  return mode === "shopify" ? previewShopify() : previewDatasetA();
}

async function bulkCommit() {
  if (!pendingBulk) return bulkLog("Click Preview first.", "var(--warning)");
  return pendingBulk.mode === "shopify" ? commitShopify() : commitDatasetA();
}

// ============================================================
// 3a. Dataset A preview
// ============================================================
async function previewDatasetA() {
  const text = document.getElementById("bulk-text").value;
  const supplierCode = document.getElementById("bulk-supplier").value.trim();
  if (!text.trim()) return bulkLog("Paste ERP text first.", "var(--warning)");
  if (!supplierCode) return bulkLog("Enter a supplier code first.", "var(--warning)");

  let cells;
  try { cells = parseDatasetA(text); }
  catch (e) { return bulkLog("Parse failed: " + e.message, "var(--danger)"); }

  const parsed = cells.map(c => ({ cells: c, payload: rowToPayload(c, supplierCode) }));
  const parseErrors = parsed.filter(p => !p.payload).length;
  const valid = parsed.filter(p => p.payload);
  if (valid.length === 0) return bulkLog("No valid records parsed.", "var(--warning)");

  const skus = valid.map(v => v.payload.sku);
  const existing = new Set();
  for (let i = 0; i < skus.length; i += 500) {
    const { data, error } = await db.from("inventory").select("sku").in("sku", skus.slice(i, i + 500));
    if (error) return bulkLog("Lookup failed: " + error.message, "var(--danger)");
    (data || []).forEach(d => existing.add(d.sku));
  }

  const willUpdate = valid.filter(v => existing.has(v.payload.sku));
  const willInsert = valid.filter(v => !existing.has(v.payload.sku) && v.payload.discontinued !== "Yes");
  const willSkip   = valid.filter(v => !existing.has(v.payload.sku) && v.payload.discontinued === "Yes");

  pendingBulk = {
    mode: "dataset-a",
    rows: [...willUpdate, ...willInsert].map(v => v.payload),
    meta: { willUpdate: willUpdate.length, willInsert: willInsert.length, willSkip: willSkip.length, total: valid.length, parseErrors }
  };

  document.getElementById("bulk-preview").innerHTML = `
    <div style="padding: 12px; background: #0f172a; border-radius: 8px; border: 1px solid var(--border);">
      <div style="font-weight: bold; margin-bottom: 8px;">Preview — Dataset A (Supplier: ${escapeHtml(supplierCode)})</div>
      <div style="color: var(--text-muted); font-size: 0.9rem;">
        Parsed: <strong>${valid.length}</strong> records${parseErrors ? ` (<strong style="color:var(--warning);">${parseErrors} parse errors skipped</strong>)` : ""}<br>
        Will update: <strong style="color: var(--info);">${willUpdate.length}</strong> existing SKUs<br>
        Will insert: <strong style="color: var(--success);">${willInsert.length}</strong> new SKUs<br>
        ${willSkip.length ? `Will skip: <strong style="color: var(--warning);">${willSkip.length}</strong> discontinued new items<br>` : ""}
      </div>
      <div style="margin-top: 12px; max-height: 400px; overflow-y: auto; font-size: 0.8rem;">
        <table style="width:100%; border-collapse:collapse;">
          <thead><tr style="background:#1e293b; color:var(--text-muted);">
            <th style="padding:6px; text-align:left;">SKU</th>
            <th style="padding:6px; text-align:left;">Description</th>
            <th style="padding:6px; text-align:center;">Action</th>
          </tr></thead>
          <tbody>
            ${valid.slice(0, 30).map(v => {
              const isUpdate = existing.has(v.payload.sku);
              const isSkip = !isUpdate && v.payload.discontinued === "Yes";
              const action = isSkip ? "Skip" : isUpdate ? "Update" : "Insert";
              const color = isSkip ? "var(--warning)" : isUpdate ? "var(--info)" : "var(--success)";
              return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:6px; font-family:monospace;">${escapeHtml(v.payload.sku)}</td>
                <td style="padding:6px; color:var(--text-muted);">${escapeHtml((v.payload.description || "").slice(0, 55))}</td>
                <td style="padding:6px; text-align:center; color:${color}; font-weight:bold;">${action}</td>
              </tr>`;
            }).join("")}
            ${valid.length > 30 ? `<tr><td colspan="3" style="padding:6px; color:var(--text-muted); text-align:center;">… ${valid.length - 30} more</td></tr>` : ""}
          </tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById("bulk-commit-btn").style.display = "inline-block";
  bulkLog(`Ready — ${pendingBulk.rows.length} records will be committed.`, "var(--accent)", 6000);
}

// ============================================================
// 4a. Dataset A commit
// ============================================================
async function commitDatasetA() {
  const rows = pendingBulk.rows;
  const meta = pendingBulk.meta;
  const btn = document.getElementById("bulk-commit-btn");
  btn.disabled = true;
  bulkLog(`Committing ${rows.length} records… do not close this tab.`, "var(--warning)");

  let processed = 0, failed = 0;
  for (let i = 0; i < rows.length; i += BULK_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + BULK_CHUNK_SIZE);
    const { error } = await db.from("inventory").upsert(chunk, { onConflict: "sku" });
    if (error) {
      failed += chunk.length;
      bulkLog(`Chunk ${Math.floor(i / BULK_CHUNK_SIZE) + 1} failed: ${error.message}`, "var(--danger)");
    } else {
      processed += chunk.length;
    }
  }

  pendingBulk = null;
  document.getElementById("bulk-preview").innerHTML = "";
  btn.style.display = "none";
  btn.disabled = false;

  const summary = `✅ Committed ${processed} records` +
    (meta.willUpdate ? ` (${meta.willUpdate} updates, ${meta.willInsert} inserts)` : "") +
    (meta.willSkip ? `, skipped ${meta.willSkip} discontinued new` : "") +
    (failed ? `. ⚠️ ${failed} FAILED.` : ".");
  bulkLog(summary, failed ? "var(--warning)" : "var(--success)", failed ? 12000 : 8000);

  if (failed === 0) {
    document.getElementById("bulk-text").value = "";
    document.getElementById("bulk-supplier").value = "";
  }
  if (typeof fetchAllAdminData === "function") fetchAllAdminData();
}

// ============================================================
// 3b. Shopify preview (enrichment only — never inserts)
// ============================================================
async function previewShopify() {
  const text = document.getElementById("bulk-text").value;
  if (!text.trim()) return bulkLog("Paste a Shopify CSV first.", "var(--warning)");

  let rows;
  try { rows = parseShopifyCsv(text); }
  catch (e) { return bulkLog("Parse failed: " + e.message, "var(--danger)"); }
  if (!rows.length) return bulkLog("No valid SKUs found in CSV.", "var(--warning)");

  const skus = rows.map(r => r.sku);
  const existing = {};
  for (let i = 0; i < skus.length; i += 500) {
    const { data, error } = await db.from("inventory")
      .select("sku, barcode, image_url")
      .in("sku", skus.slice(i, i + 500));
    if (error) return bulkLog("Lookup failed: " + error.message, "var(--danger)");
    (data || []).forEach(d => { existing[d.sku] = { barcode: d.barcode || "", image_url: d.image_url || "" }; });
  }

  const updates = [];
  const matched = [];   // for the preview table
  let imgUpdates = 0, barcodeFills = 0, unchanged = 0, skipped = 0;

  for (const row of rows) {
    if (!existing[row.sku]) { skipped++; continue; }

    const cur = existing[row.sku];
    const payload = { sku: row.sku };
    const willImg = row.image_url && row.image_url !== cur.image_url;
    const willBc  = row.barcode && !cur.barcode;

    if (willImg) { payload.image_url = row.image_url; imgUpdates++; }
    if (willBc)  { payload.barcode = row.barcode;      barcodeFills++; }

    if (Object.keys(payload).length > 1) {
      updates.push(payload);
      matched.push({ sku: row.sku, img: willImg, bc: willBc });
    } else {
      unchanged++;
    }
  }

  pendingBulk = {
    mode: "shopify",
    updates,
    meta: { imgUpdates, barcodeFills, unchanged, skipped, total: rows.length }
  };

  const summary = `
    <div style="padding: 12px; background: #0f172a; border-radius: 8px; border: 1px solid var(--border);">
      <div style="font-weight: bold; margin-bottom: 8px;">Preview — Shopify CSV (Enrichment Only)</div>
      <div style="color: var(--text-muted); font-size: 0.9rem;">
        Parsed from CSV: <strong>${rows.length}</strong> base SKUs<br>
        Matched to inventory: <strong style="color: var(--success);">${rows.length - skipped}</strong><br>
        Not in inventory (skipped): <strong style="color: var(--text-muted);">${skipped}</strong><br>
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border);">
          Image URL will update: <strong style="color: var(--info);">${imgUpdates}</strong> items<br>
          Missing barcode will be filled: <strong style="color: var(--info);">${barcodeFills}</strong> items<br>
          Already current (no change): <strong>${unchanged}</strong> items<br>
        </div>
      </div>
      ${updates.length ? `
        <div style="margin-top: 12px; max-height: 300px; overflow-y: auto; font-size: 0.8rem;">
          <table style="width:100%; border-collapse:collapse;">
            <thead><tr style="background:#1e293b; color:var(--text-muted);">
              <th style="padding:6px; text-align:left;">SKU</th>
              <th style="padding:6px; text-align:center;">Image</th>
              <th style="padding:6px; text-align:center;">Barcode</th>
            </tr></thead>
            <tbody>
              ${matched.slice(0, 20).map(m => `
                <tr style="border-bottom:1px solid var(--border);">
                  <td style="padding:6px; font-family:monospace;">${escapeHtml(m.sku)}</td>
                  <td style="padding:6px; text-align:center; color:${m.img ? 'var(--success)' : 'var(--text-muted)'};">${m.img ? "✓" : "—"}</td>
                  <td style="padding:6px; text-align:center; color:${m.bc ? 'var(--success)' : 'var(--text-muted)'};">${m.bc ? "✓" : "—"}</td>
                </tr>`).join("")}
              ${matched.length > 20 ? `<tr><td colspan="3" style="padding:6px; color:var(--text-muted); text-align:center;">… ${matched.length - 20} more</td></tr>` : ""}
            </tbody>
          </table>
        </div>` : ""}
    </div>
  `;

  document.getElementById("bulk-preview").innerHTML = summary;

  // Only show commit if there's actually something to update
  if (updates.length > 0) {
    document.getElementById("bulk-commit-btn").style.display = "inline-block";
    bulkLog(`Ready — ${updates.length} items will be enriched.`, "var(--accent)", 6000);
  } else {
    document.getElementById("bulk-commit-btn").style.display = "none";
    bulkLog(`Nothing to update — all ${rows.length - skipped} matched items are current.`, "var(--text-muted)", 6000);
  }
}

// ============================================================
// 4b. Shopify commit (enrichment only — never inserts)
// ============================================================
async function commitShopify() {
  const { updates, meta } = pendingBulk;
  if (!updates || updates.length === 0) {
    return bulkLog("Nothing to commit.", "var(--warning)");
  }

  const btn = document.getElementById("bulk-commit-btn");
  btn.disabled = true;
  bulkLog(`Enriching ${updates.length} items…`, "var(--warning)");

  let updated = 0, failed = 0;
  for (let i = 0; i < updates.length; i += BULK_CHUNK_SIZE) {
    const chunk = updates.slice(i, i + BULK_CHUNK_SIZE);
    const { error } = await db.from("inventory").upsert(chunk, { onConflict: "sku" });
    if (error) {
      failed += chunk.length;
      bulkLog(`Chunk ${Math.floor(i / BULK_CHUNK_SIZE) + 1} failed: ${error.message}`, "var(--danger)");
    } else {
      updated += chunk.length;
    }
  }

  pendingBulk = null;
  document.getElementById("bulk-preview").innerHTML = "";
  btn.style.display = "none";
  btn.disabled = false;

  const summary = `✅ Enriched ${updated} items` +
    (meta.barcodeFills ? ` (${meta.barcodeFills} barcodes filled)` : "") +
    (meta.imgUpdates ? ` (${meta.imgUpdates} image URLs updated)` : "") +
    (failed ? `. ⚠️ ${failed} FAILED.` : ".");
  bulkLog(summary, failed ? "var(--warning)" : "var(--success)", failed ? 12000 : 8000);

  if (failed === 0) document.getElementById("bulk-text").value = "";
  if (typeof fetchAllAdminData === "function") fetchAllAdminData();
}

// ============================================================
// 5. Clear
// ============================================================
function bulkClear() {
  document.getElementById("bulk-text").value = "";
  const supplierEl = document.getElementById("bulk-supplier");
  if (supplierEl) supplierEl.value = "";

  // Reset file picker
  const fileInput = document.getElementById("bulk-file");
  if (fileInput) fileInput.value = "";
  const fileLabel = document.getElementById("bulk-file-name");
  if (fileLabel) {
    fileLabel.textContent = "No file selected";
    fileLabel.style.color = "var(--text-muted)";
  }

  document.getElementById("bulk-preview").innerHTML = "";
  const commitBtn = document.getElementById("bulk-commit-btn");
  if (commitBtn) commitBtn.style.display = "none";
  pendingBulk = null;
  bulkLog("Cleared. Ready for next batch.", "var(--text-muted)", 4000);
  document.getElementById("bulk-text").focus();
}

// ============================================================
// 6. Log helper
// ============================================================
let bulkLogTimer = null;
function bulkLog(msg, color, autoClearMs = 0) {
  const el = document.getElementById("bulk-log");
  if (!el) return;
  clearTimeout(bulkLogTimer);
  el.textContent = msg;
  el.style.color = color || "var(--text-muted)";
  el.style.opacity = "1";
  el.style.transition = "opacity 0.8s ease";

  if (autoClearMs > 0) {
    bulkLogTimer = setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => {
        el.textContent = "";
        el.style.opacity = "1";
      }, 800);
    }, autoClearMs);
  }
}

// ============================================================
// 7. Wiring
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  // File picker → loads file contents into the textarea
const fileBtn = document.getElementById("bulk-file-btn");
const fileInput = document.getElementById("bulk-file");
const fileLabel = document.getElementById("bulk-file-name");

if (fileBtn && fileInput) {
  fileBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Defense in depth — browser picker filters, but verify anyway
    if (!/\.(csv|txt)$/i.test(file.name)) {
      bulkLog("Please choose a .csv or .txt file.", "var(--warning)", 5000);
      fileInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById("bulk-text").value = ev.target.result;
      if (fileLabel) {
        fileLabel.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        fileLabel.style.color = "var(--success)";
      }
      bulkLog(`Loaded: ${file.name} — click Preview to parse.`, "var(--accent)", 5000);
    };
    reader.onerror = () => {
      bulkLog("Failed to read file. Try again or paste manually.", "var(--danger)");
    };
    reader.readAsText(file);
  });
}
  const p = document.getElementById("bulk-preview-btn");
  const c = document.getElementById("bulk-commit-btn");
  const x = document.getElementById("bulk-clear-btn");
  if (p) p.addEventListener("click", bulkPreview);
  if (c) c.addEventListener("click", bulkCommit);
  if (x) x.addEventListener("click", bulkClear);

  const modeSel = document.getElementById("bulk-mode");
  if (modeSel) {
    modeSel.addEventListener("change", () => {
      const group = document.getElementById("bulk-supplier-group");
      if (group) group.style.display = modeSel.value === "dataset-a" ? "block" : "none";
      bulkClear();
    });
  }
});
