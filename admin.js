// ===== 1. CONFIGURATION =====
const SUPABASE_URL = "https://mntgvvmzmmfsbikoidtt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1udGd2dm16bW1mc2Jpa29pZHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTAwNzgsImV4cCI6MjEwODI2NjA3OH0.sbaIcQFm7LjfiqJQHZ1-ZM3EmeIvLEzzfdqEj_Ode8I";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== 2. STATE =====
let allAdminItems = [];
let displayedCount = 0;
const BATCH_SIZE = 50;

let lockedShelf = null;
let lockedShelfParsed = null;
let nextBin = null;

// ===== 3. HELPERS =====
const ROOM_BY_SEP = { ".": "Basement", "_": "MainFloor" };

function parseShelfId(raw) {
  const id = String(raw || "").trim().toUpperCase();
  if (!id) return null;
  const lastDot   = id.lastIndexOf(".");
const lastUnder = id.lastIndexOf("_");
const sep = lastUnder === -1 && lastDot === -1 ? null
          : lastUnder === -1 ? "."
          : lastDot   === -1 ? "_"
          : (lastUnder > lastDot ? "_" : ".");
  if (!sep) return null;
  const parts = id.split(sep);
  if (parts.length < 2 || !parts[0]) return null;
  return {
    fullId: id,
    floor: ROOM_BY_SEP[sep],
    aisle: parts[0],
    bay: parts[1] || "",
    shelfNumber: parts[2] || "",
    sep
  };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function getNamedShelf(shelfId) {
  const upper = String(shelfId || "").toUpperCase();
  if (!upper) return null;
  const { data, error } = await db.from("named_shelves").select("pattern, area, description");
  if (error || !data) return null;
  let best = null;
  for (const row of data) {
    const p = String(row.pattern || "").toUpperCase();
    if (p && upper.startsWith(p) && (!best || p.length > best.pattern.length)) best = row;
  }
  return best;
}

// ===== 4. DOM ELEMENTS =====
const loginScreen = document.getElementById("loginScreen");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const tableBody = document.getElementById("adminTableBody");
const itemModal = document.getElementById("itemModal");
const itemForm = document.getElementById("itemForm");

const mapperItemInput = document.getElementById("mapper-item-input");
const mapperResults = document.getElementById("mapper-results");
const mapperLog = document.getElementById("mapper-status-log");

// ===== 5. TAB SWITCHING =====
window.switchTab = (tabName) => {
  document.getElementById("tab-table").style.display = "none";
  document.getElementById("tab-mapper").style.display = "none";
  document.getElementById("tab-btn-table").classList.remove("active");
  document.getElementById("tab-btn-mapper").classList.remove("active");
  if (tabName === "table") {
    document.getElementById("tab-table").style.display = "block";
    document.getElementById("tab-btn-table").classList.add("active");
    fetchAllAdminData();
  } else {
    document.getElementById("tab-mapper").style.display = "block";
    document.getElementById("tab-btn-mapper").classList.add("active");
  }
};

// ===== 6. AUTHENTICATION =====
async function checkAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    loginScreen.style.display = "none";
    dashboard.style.display = "block";
    fetchAllAdminData();
  } else {
    loginScreen.style.display = "block";
    dashboard.style.display = "none";
  }
}

db.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") checkAuth();
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const { error } = await db.auth.signInWithPassword({
    email: document.getElementById("email").value,
    password: document.getElementById("password").value
  });
  if (error) loginError.textContent = error.message;
  else checkAuth();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await db.auth.signOut();
  checkAuth();
});

// ===== 7. MASTER TABLE =====
async function fetchAllAdminData() {
  tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Loading data...</td></tr>`;
  const { data, error } = await db.from("inventory").select("*").order("id", { ascending: false }).limit(1000);
  if (error) {
    tableBody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">Error: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  allAdminItems = data || [];
  filterAndRenderAdmin();
}

function filterAndRenderAdmin() {
  const query = document.getElementById("adminSearchInput").value.trim().toLowerCase();
  const filtered = allAdminItems.filter(item => {
    const searchable = [item.sku, item.description, item.barcode, item.category, item.status, item.shelf]
      .map(v => String(v || "")).join(" ").toLowerCase();
    return searchable.includes(query);
  });
  displayedCount = 0;
  tableBody.innerHTML = "";
  renderNextAdminBatch(filtered);
}

function renderNextAdminBatch(filteredItems) {
  const loadMoreBtn = document.getElementById("adminLoadMoreBtn");
  if (filteredItems.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No items found.</td></tr>`;
    loadMoreBtn.style.display = "none";
    return;
  }
  const nextItems = filteredItems.slice(displayedCount, displayedCount + BATCH_SIZE);

  nextItems.forEach(item => {
    const isStocked = String(item.stock).toLowerCase() === "yes";
    const safeSku = escapeHtml(item.sku);
    const safeDesc = escapeHtml(item.description || "—");
    const safeArea = escapeHtml(item.floor || item.area || "");
    const safeShelf = escapeHtml(item.shelf || "");
    const safeBin = escapeHtml(item.bin || "");
    const rowHTML = `
      <tr>
        <td><strong>${safeSku}</strong></td>
        <td>${safeDesc}</td>
        <td>
          <button data-id="${item.id}" data-stock="${escapeHtml(item.stock || 'No')}" class="js-toggle-stock"
                  style="background: ${isStocked ? '#22c55e' : '#ef4444'}; color: #000; border: none; padding: 4px 12px; border-radius: 12px; font-weight: bold; cursor: pointer;">
            ${isStocked ? 'Yes' : 'No'}
          </button>
        </td>
        <td>${safeArea} ${safeShelf} ${item.bin ? "Bin " + safeBin : ""}</td>
        <td><button data-id="${item.id}" class="js-edit" style="background:none; border:none; cursor:pointer; color:#38bdf8; font-weight:bold;">Edit</button></td>
      </tr>
    `;
    tableBody.insertAdjacentHTML("beforeend", rowHTML);
  });

  tableBody.querySelectorAll(".js-toggle-stock").forEach(btn =>
    btn.addEventListener("click", () => toggleStock(parseInt(btn.dataset.id), btn.dataset.stock)));
  tableBody.querySelectorAll(".js-edit").forEach(btn =>
    btn.addEventListener("click", () => editItem(parseInt(btn.dataset.id))));

  displayedCount += nextItems.length;
  if (displayedCount < filteredItems.length) {
    loadMoreBtn.style.display = "inline-block";
    loadMoreBtn.onclick = () => renderNextAdminBatch(filteredItems);
  } else {
    loadMoreBtn.style.display = "none";
  }
}

document.getElementById("adminSearchInput").addEventListener("input", () => {
  clearTimeout(window.adminSearchTimer);
  window.adminSearchTimer = setTimeout(filterAndRenderAdmin, 300);
});


// ===== 8. SHELF MAPPER =====
document.getElementById("shelf-lock-input").addEventListener("change", async (e) => {
  const parsed = parseShelfId(e.target.value);
  if (!parsed) {
    updateLog(`"${e.target.value}" is not a valid shelf ID (expected A_1_2 or A.1.2)`, "#ef4444");
    e.target.value = "";
    e.target.focus();
    return;
  }

  updateLog(`Locking ${parsed.fullId}...`, "var(--warning)");

  const { data, error } = await db.from("inventory").select("bin").eq("shelf", parsed.fullId);
  if (error) { updateLog("Error locking shelf: " + error.message, "#ef4444"); return; }

  let maxBin = 0;
  (data || []).forEach(r => {
    const b = parseInt(r.bin);
    if (!isNaN(b) && b > maxBin) maxBin = b;
  });

  lockedShelf = parsed.fullId;
  lockedShelfParsed = parsed;
  nextBin = maxBin + 1;

  const named = await getNamedShelf(parsed.fullId);

  e.target.disabled = true;
  document.getElementById("shelf-info-display").style.display = "block";
  document.getElementById("active-shelf-label").textContent = lockedShelf;
  document.getElementById("next-bin-label").textContent = String(nextBin).padStart(2, "0");

  // Show the pill only if the HTML still has it (harmless if not)
  const unlockBtn = document.getElementById("unlock-shelf-btn");
  if (unlockBtn) unlockBtn.style.display = "inline-block";

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText("display-floor", parsed.floor || "—");
  setText("display-aisle", parsed.aisle || "—");
  setText("display-bay", parsed.bay || "—");
  setText("display-shelf-number", parsed.shelfNumber || "—");
  setText("display-named-shelf", named ? `${named.area}${named.description ? " — " + named.description : ""}` : "");

  const scanSection = document.getElementById("item-scan-section");
  scanSection.style.opacity = "1";
  scanSection.style.pointerEvents = "auto";
  mapperItemInput.focus();

  updateLog(
    `Locked ${parsed.fullId} — ${parsed.floor}` +
    `${parsed.aisle ? ", Aisle " + parsed.aisle : ""}` +
    `${parsed.bay ? ", Bay " + parsed.bay : ""}` +
    `${parsed.shelfNumber ? ", Shelf " + parsed.shelfNumber : ""}. Next bin: ${nextBin}`,
    "var(--accent)"
  );
});

/**
 * End the current shelf session and return to "ready for next shelf" state.
 * Does NOT touch the database — items already assigned keep their shelf/bin.
 * Called by both the "✓ Done — Scan Next Shelf" button and the small pill.
 */
function endShelfSession() {
  lockedShelf = null;
  lockedShelfParsed = null;
  nextBin = null;

  const shelfInput = document.getElementById("shelf-lock-input");
  shelfInput.disabled = false;
  shelfInput.value = "";

  const unlockBtn = document.getElementById("unlock-shelf-btn");
  if (unlockBtn) unlockBtn.style.display = "none";

  const infoDisplay = document.getElementById("shelf-info-display");
  if (infoDisplay) infoDisplay.style.display = "none";

  const qrPanel = document.getElementById("qr-panel");
  if (qrPanel) qrPanel.style.display = "none";

  const scanSection = document.getElementById("item-scan-section");
  scanSection.style.opacity = "0.5";
  scanSection.style.pointerEvents = "none";
  mapperItemInput.value = "";
  mapperResults.innerHTML = "";

  updateLog("Ready for next shelf — scan or type shelf ID.", "var(--text-muted)");

  // Auto-focus + scroll so a barcode scanner lands in the right field
  shelfInput.focus();
  shelfInput.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Wire both buttons (whichever exist — safe if you removed one)
const nextShelfBtn = document.getElementById("next-shelf-btn");
if (nextShelfBtn) nextShelfBtn.addEventListener("click", endShelfSession);

const unlockBtnEl = document.getElementById("unlock-shelf-btn");
if (unlockBtnEl) unlockBtnEl.addEventListener("click", endShelfSession);

let mapperSearchTimer = null;
let mapperSearchToken = 0;

mapperItemInput.addEventListener("input", (e) => {
  clearTimeout(mapperSearchTimer);
  const raw = e.target.value.trim();
  if (raw.length < 2) { mapperResults.innerHTML = ""; return; }
  mapperSearchTimer = setTimeout(() => runMapperSearch(raw), 250);
});

async function runMapperSearch(raw) {
  const sanitized = raw.replace(/[,()*%]/g, " ").trim();
  if (!sanitized) { mapperResults.innerHTML = ""; return; }

  const token = ++mapperSearchToken;
  const { data, error } = await db.from("inventory")
    .select("id, sku, description, barcode, ssl_barcode, shelf, bin")
    .or(`sku.ilike.%${sanitized}%,description.ilike.%${sanitized}%,barcode.ilike.%${sanitized}%`)
    .limit(10);

  if (token !== mapperSearchToken) return;
  if (error) { updateLog("Search error: " + error.message, "#ef4444"); return; }

  if (!data || data.length === 0) {
    mapperResults.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--text-muted);">No matches.</div>`;
    return;
  }

  mapperResults.innerHTML = data.map(item => {
    const sku = escapeHtml(item.sku);
    const desc = escapeHtml(item.description || "—");
    const bc = escapeHtml(item.barcode || "");
    const ssl = escapeHtml(item.ssl_barcode || "");
    const shelf = escapeHtml(item.shelf || "");
    const bin = escapeHtml(item.bin || "");
    return `
      <div class="mapper-item-card">
        <div class="mapper-item-info">
          <div class="mapper-item-title">${desc}</div>
          <div class="mapper-item-sku">SKU: ${sku}${item.barcode ? ` | BC: ${bc}` : ''}</div>
          ${item.shelf ? `<div style="font-size: 0.75rem; color: var(--warning); margin-top: 4px;">Currently at: ${shelf}${item.bin ? " — Bin " + bin : ""}</div>` : ''}
        </div>
        <div class="mapper-actions">
          <button data-sku="${sku}" class="btn-primary js-assign" style="padding: 6px 12px; font-size: 0.8rem;">Assign</button>
          <input type="text" data-sku="${sku}" class="js-ssl" placeholder="SSL Barcode" value="${ssl}" style="padding: 4px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-dark); color: white; width: 110px;" />
        </div>
      </div>
    `;
  }).join("");

  mapperResults.querySelectorAll(".js-assign").forEach(btn =>
    btn.addEventListener("click", () => assignToShelf(btn.dataset.sku)));
  mapperResults.querySelectorAll(".js-ssl").forEach(inp =>
    inp.addEventListener("change", () => updateSsl(inp.dataset.sku, inp.value)));
}

window.assignToShelf = async (sku) => {
  if (!lockedShelf) { updateLog("No shelf locked.", "#ef4444"); return; }
  updateLog(`Assigning ${sku}...`, "var(--warning)");

  const { data, error: readErr } = await db.from("inventory").select("bin").eq("shelf", lockedShelf);
  if (readErr) { updateLog("Read failed: " + readErr.message, "#ef4444"); return; }

  let maxBin = 0;
  (data || []).forEach(r => {
    const b = parseInt(r.bin);
    if (!isNaN(b) && b > maxBin) maxBin = b;
  });
  const binStr = String(maxBin + 1).padStart(2, "0");

  const { error } = await db.from("inventory").update({ shelf: lockedShelf, bin: binStr }).eq("sku", sku);
  if (error) { updateLog("Assign failed: " + error.message, "#ef4444"); return; }

  nextBin = maxBin + 2;
  document.getElementById("next-bin-label").textContent = String(nextBin).padStart(2, "0");
  updateLog(`✅ ${sku} → ${lockedShelf} / Bin ${binStr}`, "var(--success)");

  mapperItemInput.value = "";
  mapperResults.innerHTML = "";
  mapperItemInput.focus();
};

window.updateSsl = async (sku, barcode) => {
  const { error } = await db.from("inventory").update({ ssl_barcode: barcode }).eq("sku", sku);
  if (error) updateLog("SSL update failed: " + error.message, "#ef4444");
  else updateLog(`🔗 SSL linked to ${sku}`, "var(--accent)");
};

function updateLog(msg, color) {
  mapperLog.textContent = msg;
  mapperLog.style.color = color;
}

// ===== 9. QR =====
let qrInstance = null;

document.getElementById("qr-toggle-btn").addEventListener("click", () => {
  const panel = document.getElementById("qr-panel");
  const shelfId = document.getElementById("shelf-lock-input").value.trim().toUpperCase() || "SCAN-SHELF";

  if (panel.style.display === "none" || !panel.style.display) {
    panel.style.display = "block";
    document.getElementById("qr-code-display").innerHTML = "";
    if (qrInstance) { qrInstance.clear(); qrInstance = null; }
    qrInstance = new QRCode(document.getElementById("qr-code-display"), {
      text: shelfId, width: 128, height: 128, correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    panel.style.display = "none";
    if (qrInstance) { qrInstance.clear(); qrInstance = null; }
  }
});

document.getElementById("print-qr-btn").addEventListener("click", () => {
  const raw = document.getElementById("shelf-lock-input").value.trim().toUpperCase();
  if (!raw) return alert("Type a shelf ID first.");
  if (!/^[A-Z0-9._]+$/.test(raw)) return alert("Shelf ID contains invalid characters.");

  const safeForJs = JSON.stringify(raw);
  const safeForHtml = escapeHtml(raw);

  const printWindow = window.open("", "_blank");
  if (!printWindow) return alert("Please allow popups.");

  printWindow.document.write(`
    <html><head><title>Label ${safeForHtml}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <style>
      @page { margin: 0; }
      body { margin:0; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; }
      #qr { margin-bottom: 20px; }
    </style></head>
    <body>
      <div id="qr"></div>
      <h1 style="font-size: 40px; font-weight: 900; margin: 0;">${safeForHtml}</h1>
      <script>
        new QRCode(document.getElementById("qr"), { text: ${safeForJs}, width: 300, height: 300 });
        setTimeout(() => { window.print(); window.close(); }, 800);
      <\/script>
    </body></html>
  `);
  printWindow.document.close();
});

// ===== 10. INIT =====
checkAuth();
