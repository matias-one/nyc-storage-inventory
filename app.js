// ===== 1. CONFIGURATION =====
// 👇 REPLACE THESE WITH YOUR OWN SUPABASE URL AND ANON KEY
const SUPABASE_URL = "https://mntgvvmzmmfsbikoidtt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1udGd2dm16bW1mc2Jpa29pZHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTAwNzgsImV4cCI6MjEwODI2NjA3OH0.sbaIcQFm7LjfiqJQHZ1-ZM3EmeIvLEzzfdqEj_Ode8I";

// Initialize Supabase
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== 2. STATE =====
let inventoryItems = [];
let filteredItems = [];
let displayedCount = 0;
const BATCH_SIZE = 50; 
let currentFilter = "all";

// ===== 3. BONOBO LOGIC: ETA Cleaner & Parsers =====
function cleanEta(value) {
  if (!value) return '';
  let cleaned = String(value).replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.includes('|')) cleaned = cleaned.split('|')[0].trim();
  const dateRegex = /\b(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\b/;
  const match = cleaned.match(dateRegex);
  if (match) return match[1];
  return cleaned.split(' ')[0] || cleaned;
}

function parseShelf(raw) {
  if (!raw) return { rack: '?', level: '00' };
  const s = String(raw).trim();
  const num = s.match(/(\d+)/);
  const level = num ? num[1].padStart(2, '0') : '00';
  let rack = s[0].toUpperCase();
  if (s.startsWith('BR')) rack = 'BR';
  return { rack, level };
}

function getAreaCode(area, section) {
  // Uses the actual 'area' column if it exists, otherwise guesses from 'section'
  const a = (area || '').toLowerCase();
  const s = (section || '').toLowerCase();
  if (a.includes('pi') || s.includes('pottery')) return 'PI';
  if (a.includes('cr') || s.includes('ceramic')) return 'CR';
  if (a.includes('br') || s.includes('boiler')) return 'BR';
  if (a.includes('ci') || s.includes('candle')) return 'CI';
  return 'default';
}

function getStatusBadge(stock, eta, discontinued) {
  const etaText = cleanEta(eta);
  const isDisc = String(discontinued).toLowerCase() === 'yes' || String(discontinued) === 'true' || String(discontinued) === '1';
  
  if (isDisc) {
    return { label: 'D/C', css: 'badge-discontinued', icon: '⛔' };
  }
  
  // Handle both boolean strings ("yes") and actual numbers from Supabase
  const isStocked = String(stock).toLowerCase() === 'yes' || parseInt(stock) > 0;
  
  if (isStocked) {
    return { label: 'In Stock', css: 'badge-instock', icon: '✓' };
  } else {
    if (etaText) {
      return { label: 'ETA: ' + etaText, css: 'badge-eta', icon: '🚚' };
    }
    return { label: 'Out of Stock', css: 'badge-out', icon: '✕' };
  }
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
    itemListElement.innerHTML = `<p style="text-align:center; color:red;">Failed to load data: ${err.message}</p>`;
  }
}

// ===== 5. FILTER & SEARCH =====
function filterAndSearch() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();

  filteredItems = inventoryItems.filter((item) => {
    const searchable = [
      item.sku, item.description, item.barcode, item.category, 
      item.stock, item.status, item.eta, item.online, item.discontinued, 
      item.supplier, item.area, item.shelf, item.bin, item.ssl_barcode, 
      item.note, item.section
    ].map((v) => (v == null ? "" : String(v).toLowerCase())).join(" ");

    const matchesSearch = searchable.includes(query);

    let matchesFilter = true;
    const isDisc = String(item.discontinued).toLowerCase() === 'yes' || String(item.discontinued) === '1' || String(item.discontinued) === 'true';
    const isStocked = String(item.stock).toLowerCase() === 'yes' || parseInt(item.stock) > 0;

    if (currentFilter === "in-stock") matchesFilter = isStocked;
    else if (currentFilter === "out-of-stock") matchesFilter = !isStocked;
    else if (currentFilter === "discontinued") matchesFilter = isDisc;

    return matchesSearch && matchesFilter;
  });

  // BONOBO LOGIC: Push discontinued items to the bottom
  filteredItems.sort((a, b) => {
    const aDisc = String(a.discontinued).toLowerCase() === 'yes' || String(a.discontinued) === '1';
    const bDisc = String(b.discontinued).toLowerCase() === 'yes' || String(b.discontinued) === '1';
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
    // 1. Build BONOBO Location Data
    const rawShelf = item.shelf ? String(item.shelf).trim() : '';
    const { rack, level } = parseShelf(rawShelf);
    const areaCode = getAreaCode(item.area, item.section);
    const bin = item.bin ? String(item.bin).padStart(2, '0') : '00';
    const locationID = `${areaCode.toUpperCase()}-${rack}-${level}-${bin}`;
    
    // 2. Build Badges
    const badge = getStatusBadge(item.stock, item.eta, item.discontinued);
    const isDisc = badge.label === 'D/C';
    const cardClass = isDisc ? 'card-discontinued' : '';

    // 3. Render
    const cardHTML = `
      <div class="item-card ${cardClass}">
        <div>
          <div class="item-image-container">
            ${item.image_url 
              ? `<img src="${item.image_url}" onerror="this.parentElement.innerHTML='<span style=\\'color:#64748b; font-size:0.8rem;\\'>No Image</span>'">` 
              : `<span style="color:#64748b; font-size:0.8rem;">No Image</span>`}
          </div>

          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 8px;">
            <div class="item-title">${item.description || "Unnamed Item"}</div>
            <span class="status-badge ${badge.css}">${badge.icon} ${badge.label}</span>
          </div>
          
          <div class="item-sku">${item.sku || "NO SKU"}</div>
          
          <div class="location-box">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span class="location-id">${locationID}</span>
              <span class="area-badge area-${areaCode}">${areaCode.toUpperCase()}</span>
            </div>
            
            <div style="margin-bottom: 4px;">
              ${item.category ? `<strong>Category:</strong> ${item.category}` : ''}
            </div>
            
            <div style="color: #94a3b8; font-size: 0.8rem; margin-top: 6px; border-top: 1px solid #334155; padding-top: 6px;">
              <div>Area: <span style="color:white;">${item.section || item.area || '—'}</span> · Shelf: <span style="color:white;">${item.shelf || '—'}</span> · Bin: <span style="color:white;">${item.bin || '—'}</span></div>
              ${item.ssl_barcode ? `<div class="font-mono" style="color:#94a3b8;">SSL: ${item.ssl_barcode}</div>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", cardHTML);
  });

  displayedCount += nextItems.length;

  if (displayedCount < filteredItems.length) {
    loadMoreContainer.style.display = "block";
  } else {
    loadMoreContainer.style.display = "none";
  }
}

// ===== 7. EVENT LISTENERS =====
let debounceTimer;
const searchInput = document.getElementById("searchInput");

// Search with debounce
searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(filterAndSearch, 300);
});

// Clear button
document.getElementById("clearBtn").addEventListener("click", () => {
  searchInput.value = "";
  filterAndSearch();
  searchInput.focus();
});

// Filters
document.querySelectorAll(".filter-pill").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    document.querySelectorAll(".filter-pill").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    currentFilter = e.target.dataset.filter;
    filterAndSearch();
  });
});

document.getElementById("loadMoreBtn").addEventListener("click", renderNextBatch);

// ===== 8. INITIAL LOAD =====
window.onload = () => {
  searchInput.focus(); // Auto-focus for barcode scanners!
  fetchInventory();
};
