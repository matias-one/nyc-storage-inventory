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
const BATCH_SIZE = 50; // Render 50 cards at a time
let currentFilter = "all";

// ===== 3. FETCH DATA =====
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

// ===== 4. FILTER & SEARCH LOGIC =====
function filterAndSearch() {
  const query = document.getElementById("searchInput").value.trim().toLowerCase();

  filteredItems = inventoryItems.filter((item) => {
    // 1. Apply Search Query (searches all fields)
    const searchable = [
      item.sku, item.description, item.barcode, item.category, 
      item.stock, item.status, item.eta, item.online, item.discontinued, 
      item.supplier, item.area, item.shelf, item.bin, item.ssl_barcode, 
      item.note, item.section
    ].map((v) => (v == null ? "" : String(v).toLowerCase())).join(" ");

    const matchesSearch = searchable.includes(query);

    // 2. Apply Quick Filters
    let matchesFilter = true;
    const statusStr = (item.status || "").toLowerCase();
    const stockStr = String(item.stock || "");
    
    if (currentFilter === "in-stock") {
      matchesFilter = statusStr.includes("in stock") || parseInt(stockStr) > 0;
    } else if (currentFilter === "out-of-stock") {
      matchesFilter = statusStr.includes("out of stock") || parseInt(stockStr) <= 0;
    } else if (currentFilter === "discontinued") {
      matchesFilter = String(item.discontinued).toLowerCase() === "yes" || String(item.discontinued) === "1" || String(item.discontinued) === "true";
    }

    return matchesSearch && matchesFilter;
  });

  // Reset rendering
  displayedCount = 0;
  document.getElementById("itemList").innerHTML = "";
  renderNextBatch();
}

// ===== 5. RENDER CARDS =====
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
    // Determine Status Color
    let statusClass = "status-in-stock";
    const statusStr = (item.status || "").toLowerCase();
    if (statusStr.includes("out") || parseInt(item.stock) <= 0) statusClass = "status-out-of-stock";
    if (statusStr.includes("low") || parseInt(item.stock) < 5) statusClass = "status-low";

    const isDisc = String(item.discontinued).toLowerCase() === "yes" || String(item.discontinued) === "1";

    const cardHTML = `
      <div class="item-card">
        <div>
          <div class="item-title">${item.description || "Unnamed Item"}</div>
          <div class="item-sku">${item.sku || "NO SKU"}</div>
          
          <div class="location-badge">
            📍 ${item.area || "Basement"} • Sec ${item.section || "-"} • Shelf ${item.shelf || "-"} • Bin ${item.bin || "-"}
          </div>

          <div class="badge-row">
            ${item.category ? `<span class="badge">🏷️ ${item.category}</span>` : ""}
            ${item.stock ? `<span class="badge">📦 Qty: ${item.stock}</span>` : ""}
            <span class="badge ${statusClass}">${item.status || "Unknown"}</span>
            ${isDisc ? `<span class="badge status-disc">🚫 Discontinued</span>` : ""}
          </div>
        </div>

        <div style="font-size: 0.85rem; color: #cbd5e1; border-top: 1px solid var(--border); padding-top: 10px;">
          ${item.barcode ? `<div><strong>Barcode:</strong> ${item.barcode}</div>` : ""}
          ${item.supplier ? `<div><strong>Supplier:</strong> ${item.supplier}</div>` : ""}
          ${item.note ? `<div style="color: var(--warning); margin-top: 6px;">📝 ${item.note}</div>` : ""}
        </div>
      </div>
    `;
    container.insertAdjacentHTML("beforeend", cardHTML);
  });

  displayedCount += nextItems.length;

  // Show/Hide "Load More" button
  if (displayedCount < filteredItems.length) {
    loadMoreContainer.style.display = "block";
  } else {
    loadMoreContainer.style.display = "none";
  }
}

// ===== 6. EVENT LISTENERS =====

// Search input with Debounce (waits 300ms after typing stops to prevent lag)
let debounceTimer;
document.getElementById("searchInput").addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(filterAndSearch, 300);
});

// Filter Buttons
document.querySelectorAll(".filter-pill").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    // Update UI
    document.querySelectorAll(".filter-pill").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");
    
    // Update Logic
    currentFilter = e.target.dataset.filter;
    filterAndSearch();
  });
});

// Load More Button
document.getElementById("loadMoreBtn").addEventListener("click", renderNextBatch);

// ===== 7. INITIAL LOAD =====
fetchInventory();
