// ===== 1. CONFIGURATION =====
const SUPABASE_URL = "https://mntgvvmzmmfsbikoidtt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1udGd2dm16bW1mc2Jpa29pZHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTAwNzgsImV4cCI6MjEwODI2NjA3OH0.sbaIcQFm7LjfiqJQHZ1-ZM3EmeIvLEzzfdqEj_Ode8I";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== 2. STATE =====
let inventoryItems = [];
let filteredItems = [];
let displayedCount = 0;
const BATCH_SIZE = 50;
let currentFilter = "all";
let namedShelves = [];

// ===== 3. HELPERS =====
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function cleanEta(value) {
  if (!value) return "";
  let cleaned = String(value).replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.includes("|")) cleaned = cleaned.split("|")[0].trim();
  const dateRegex = /\b(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\b/;
  const match = cleaned.match(dateRegex);
  if (match) return match[1];
  return cleaned.split(" ")[0] || cleaned;
}

/**
 * Use the Postgres generated columns; fall back to raw shelf for legacy rows.
 * Returns: { floor, aisle, bay, shelfNum, bin, rawShelf, hasLocation }
 */
function getLocationParts(item) {
  const floor = String(item.floor || "").trim();
  const aisle = String(item.aisle || "").trim();
  const bay = String(item.bay || "").trim();
  const shelfNum = String(item.shelf_number || "").trim();
  const bin = item.bin != null && item.bin !== "" ? String(item.bin) : "";
  const rawShelf = String(item.shelf || "").trim();

  const hasLocation = Boolean(floor || aisle || bay || shelfNum || rawShelf || bin);

  // Legacy fallback — old items may have `section`/`area` but no shelf
  if (!hasLocation) {
    const legacyArea = String(item.section || item.area || "").trim();
    return { floor: legacyArea, aisle: "", bay: "", shelfNum: "", bin, rawShelf: "", hasLocation: Boolean(legacyArea) };
  }
  return { floor, aisle, bay, shelfNum, bin, rawShelf, hasLocation };
}

function getStatusBadge(stock, eta, discontinued) {
  const etaText = cleanEta(eta);
  const isDisc = String(discontinued).toLowerCase() === "yes"
              || String(discontinued) === "true"
              || String(discontinued) === "1";

  if (isDisc) return { label: "D/C", css: "badge-discontinued", icon: "⛔" };

  const isStocked = String(stock).toLowerCase() === "yes" || parseInt(stock) > 0;
  if (isStocked) return { label: "In Stock", css: "badge-instock", icon: "✓" };
  if (etaText)   return { label: "ETA: " + etaText, css: "badge-eta", icon: "🚚" };
  return { label: "Out of Stock", css: "badge-out", icon: "✕" };
}

function getNamedLabel(shelfId) {
  const upper = String(shelfId || "").toUpperCase();
  if (!upper) return null;
  let best = null;
  for (const row of namedShelves) {
    const p = String(row.pattern || "").toUpperCase();
    if (p && upper.startsWith(p) && (!best || p.length > best.pattern.length)) best = row;
  }
  return best;
}

// ===== 4. FETCH DATA =====
async function fetchInventory() {
  const itemListElement = document.getElementById("itemList");
  let allItems = [];
  let from = 0;
  const PAGE_SIZE = 1000;

  try {
    while (true) {
      const { data, error } = await db
        .from("inventory")
        .select("*")
        .order("sku", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      allItems = allItems.concat(data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    inventoryItems = allItems;
    console.log(`✅ Fetched ${inventoryItems.length} inventory rows.`);
    filterAndSearch();
  } catch (err) {
    console.error("❌ Error:", err);
    itemListElement.innerHTML = `<p style="text-align:center; color:red;">Failed to load data: ${escapeHtml(err.message)}</p>`;
  }
}

async function loadNamedShelves() {
  const { data } = await db.from("named_shelves").select("pattern, area, description");
  namedShelves = data || [];
}

// ===== 5. FILTER & SEARCH =====
function filterAndSearch() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();

  filteredItems = inventoryItems.filter((item) => {
    const searchable = [
      item.sku, item.description, item.barcode, item.category,
      item.stock, item.status, item.eta, item.online, item.discontinued,
      item.supplier, item.area, item.section, item.shelf, item.bin,
      item.ssl_barcode, item.note,
      item.floor, item.aisle, item.bay, item.shelf_number   // ← new schema
    ].map(v => (v == null ? "" : String(v).toLowerCase())).join(" ");

    const matchesSearch = searchable.includes(query);

    let matchesFilter = true;
    const isDisc = String(item.discontinued).toLowerCase() === "yes"
                || String(item.discontinued) === "1"
                || String(item.discontinued) === "true";
    const isStocked = String(item.stock).toLowerCase() === "yes" || parseInt(item.stock) > 0;

    if (currentFilter === "in-stock")     matchesFilter = isStocked;
    else if (currentFilter === "out-of-stock") matchesFilter = !isStocked;
    else if (currentFilter === "discontinued") matchesFilter = isDisc;

    return matchesSearch && matchesFilter;
  });

  // Push discontinued to bottom
  filteredItems.sort((a, b) => {
    const aDisc = String(a.discontinued).toLowerCase() === "yes" || String(a.discontinued) === "1";
    const bDisc = String(b.discontinued).toLowerCase() === "yes" || String(b.discontinued) === "1";
    return aDisc - bDisc;
  });

  displayedCount = 0;
  document.getElementById("itemList").innerHTML = "";
  renderNextBatch();
}

// ===== 6. RENDER CARDS =====
function renderNextBatch() {
  const container = document.getElementById("itemList");
  const loadMoreContainer = document.getElementById("loadMoreContainer");
  const resultsInfo = document.getElementById("resultsInfo");

  if (filteredItems.length === 0) {
    container.innerHTML = `<p style="text-align:center; color: var(--text-muted); grid-column: 1/-1;">No items matched your search.</p>`;
    resultsInfo.textContent = "";
    loadMoreContainer.style.display = "none";
    return;
  }

  resultsInfo.textContent = `Showing ${Math.min(displayedCount + BATCH_SIZE, filteredItems.length)} of ${filteredItems.length} items`;

  const nextItems = filteredItems.slice(displayedCount, displayedCount + BATCH_SIZE);

  nextItems.forEach((item) => {
    const loc = getLocationParts(item);
    const badge = getStatusBadge(item.stock, item.eta, item.discontinued);
    const isDisc = badge.label === "D/C";
    const cardClass = isDisc ? "card-discontinued" : "";

    // Header line: full human-readable location, e.g. "Basement · Aisle B · Bay 7 · Shelf 3"
    const parts = [];
    if (loc.floor)    parts.push(loc.floor);
    if (loc.aisle)    parts.push("Aisle " + loc.aisle);
    if (loc.bay)      parts.push("Bay " + loc.bay);
    if (loc.shelfNum) parts.push("Shelf " + loc.shelfNum);
    const humanLocation = parts.length ? parts.join(" · ") : "No location set";

    // Secondary line: raw scanable ID + bin
    const rawLineBits = [];
    if (loc.rawShelf) rawLineBits.push(loc.rawShelf);
    if (loc.bin)      rawLineBits.push("Bin " + loc.bin);
    const rawLine = rawLineBits.join(" · ");

    // Named shelf label (e.g. "Pottery Isle — Back/Top Shelf")
    const named = getNamedLabel(loc.rawShelf);
    const namedLine = named
      ? `${escapeHtml(named.area)}${named.description ? " — " + escapeHtml(named.description) : ""}`
      : "";

    // Floor badge — derive a short code; unknown → no color
    const floorLower = (loc.floor || "").toLowerCase();
    const areaCode = floorLower.includes("basement") ? "BR"
                    : floorLower.includes("str") || floorLower.includes("ceramic") ? "CR"
                    : floorLower.includes("pottery") ? "PI"
                    : floorLower.includes("candle") ? "CI"
                    : "default";

    const safeImage = escapeHtml(item.image_url || "");
    const safeDesc = escapeHtml(item.description || "Unnamed Item");
    const safeSku = escapeHtml(item.sku || "NO SKU");
    const safeCat = escapeHtml(item.category || "");
    const safeSsl = escapeHtml(item.ssl_barcode || "");
    const safeNamed = escapeHtml(namedLine);

    const cardHTML = `
      <div class="item-card ${cardClass}">
        <div>
          <div class="item-image-container">
            ${item.image_url
              ? `<img src="${safeImage}" alt="${safeDesc}" onerror="this.style.display='none';this.parentElement.insertAdjacentHTML('beforeend','<span style=\\'color:#64748b;font-size:0.8rem;\\'>No Image</span>')">`
              : `<span style="color:#64748b; font-size:0.8rem;">No Image</span>`}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 8px;">
            <div class="item-title">${safeDesc}</div>
            <span class="status-badge ${badge.css}">${badge.icon} ${badge.label}</span>
          </div>

          <div class="item-sku">${safeSku}</div>

          <div class="location-box">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:8px;">
              <div style="flex:1; min-width:0;">
                <div style="font-weight: bold; color: white; font-size: 0.95rem;">${humanLocation}</div>
                ${rawLine ? `<div style="font-family: monospace; font-size: 0.8rem; color: #94a3b8; margin-top: 2px;">${rawLine}</div>` : ""}
                ${namedLine ? `<div style="font-size: 0.8rem; color: #38bdf8; margin-top: 4px;">📍 ${safeNamed}</div>` : ""}
              </div>
              <span class="area-badge area-${areaCode}">${areaCode.toUpperCase()}</span>
            </div>

            ${safeCat ? `<div><strong>Category:</strong> ${safeCat}</div>` : ""}

            ${safeSsl ? `<div style="color:#94a3b8; font-size:0.8rem; margin-top:6px; border-top:1px solid #334155; padding-top:6px;">SSL: <span class="font-mono">${safeSsl}</span></div>` : ""}
          </div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", cardHTML);
  });

  displayedCount += nextItems.length;
  loadMoreContainer.style.display = displayedCount < filteredItems.length ? "block" : "none";
}

// ===== 7. EVENT LISTENERS =====
let debounceTimer;
const searchInput = document.getElementById("searchInput");

searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(filterAndSearch, 300);
});

document.getElementById("clearBtn").addEventListener("click", () => {
  searchInput.value = "";
  filterAndSearch();
  searchInput.focus();
});

document.querySelectorAll(".filter-pill").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    document.querySelectorAll(".filter-pill").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    currentFilter = e.target.dataset.filter;
    filterAndSearch();
  });
});

document.getElementById("loadMoreBtn").addEventListener("click", renderNextBatch);

// ===== 8. INIT =====
window.onload = async () => {
  searchInput.focus();
  await loadNamedShelves();   // small, fast, cached for the session
  fetchInventory();
};
