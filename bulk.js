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
// 3. Preview
// ============================================================
async function bulkPreview() {
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

  // Look up existing SKUs
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

  pendingBulkPayload = [...willUpdate, ...willInsert].map(v => v.payload);
  pendingBulkMeta = { willUpdate: willUpdate.length, willInsert: willInsert.length, willSkip: willSkip.length, total: valid.length, parseErrors };

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
  bulkLog(`Ready — ${pendingBulkPayload.length} records will be committed.`, "var(--accent)");
}

// ============================================================
// 4. Commit
// ============================================================
async function bulkCommit() {
  if (!pendingBulkPayload) return bulkLog("Click Preview first.", "var(--warning)");
  const btn = document.getElementById("bulk-commit-btn");
  btn.disabled = true;
  bulkLog(`Committing ${pendingBulkPayload.length} records… do not close this tab.`, "var(--warning)");

  let processed = 0, failed = 0;
  for (let i = 0; i < pendingBulkPayload.length; i += BULK_CHUNK_SIZE) {
    const chunk = pendingBulkPayload.slice(i, i + BULK_CHUNK_SIZE);
    const { error } = await db.from("inventory").upsert(chunk, { onConflict: "sku" });
    if (error) {
      failed += chunk.length;
      bulkLog(`Chunk ${Math.floor(i / BULK_CHUNK_SIZE) + 1} failed: ${error.message}`, "var(--danger)");
    } else {
      processed += chunk.length;
    }
  }

  const meta = pendingBulkMeta || {};
  pendingBulkPayload = null;
  pendingBulkMeta = null;
  document.getElementById("bulk-preview").innerHTML = "";
  btn.style.display = "none";
  btn.disabled = false;

  const summary = `✅ Committed ${processed} records` +
    (meta.willUpdate ? ` (${meta.willUpdate} updates, ${meta.willInsert} inserts)` : "") +
    (meta.willSkip ? `, skipped ${meta.willSkip} discontinued new` : "") +
    (failed ? `. ⚠️ ${failed} FAILED.` : ".");
  bulkLog(summary, failed ? "var(--warning)" : "var(--success)");
  if (typeof fetchAllAdminData === "function") fetchAllAdminData();
}

function bulkLog(msg, color) {
  const el = document.getElementById("bulk-log");
  if (!el) return;
  el.textContent = msg;
  el.style.color = color || "var(--text-muted)";
}

document.addEventListener("DOMContentLoaded", () => {
  const p = document.getElementById("bulk-preview-btn");
  const c = document.getElementById("bulk-commit-btn");
  if (p) p.addEventListener("click", bulkPreview);
  if (c) c.addEventListener("click", bulkCommit);
});
