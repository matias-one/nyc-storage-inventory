// ===== 1. CONFIGURATION =====
// 👇 REPLACE THESE WITH YOUR OWN SUPABASE URL AND ANON KEY
const SUPABASE_URL = "https://mntgvvmzmmfsbikoidtt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1udGd2dm16bW1mc2Jpa29pZHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTAwNzgsImV4cCI6MjEwODI2NjA3OH0.sbaIcQFm7LjfiqJQHZ1-ZM3EmeIvLEzzfdqEj_Ode8I";

// Initialize Supabase
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== 2. STATE =====
let inventoryItems = [];

// ===== 3. FETCH ALL INVENTORY (WITH PAGINATION) =====
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
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;

      if (!data || data.length === 0) break;
      allItems = allItems.concat(data);
      if (data.length < PAGE_SIZE) break; 
      from += PAGE_SIZE;
    }

    inventoryItems = allItems;
    console.log(`✅ Fetched ${inventoryItems.length} inventory rows.`);
    
    if (inventoryItems.length > 0) {
      console.log("Sample row data:", inventoryItems[0]);
    }
    
    renderItems(inventoryItems);
  } catch (err) {
    console.error("❌ Error loading Supabase data:", err);
    itemListElement.innerHTML = `<p class="alert">Failed to load data: ${err.message}</p>`;
  }
}

// ===== 4. RENDER CARDS =====
function renderItems(items) {
  const container = document.getElementById("itemList");

  if (items.length === 0) {
    container.innerHTML = `<p style="text-align:center; color: var(--text-muted);">No items found.</p>`;
    return;
  }

  container.innerHTML = items
    .map(
      (item) => `
    <div class="item-card">
      <div>
        ${item.image_url ? `<img src="${item.image_url}" style="width: 100%; height: 140px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;" />` : ""}
        
        <div class="item-title">${item.description || "Unnamed Item"}</div>
        <div class="item-sku">
          <strong>SKU:</strong> ${item.sku || "N/A"} <br/> 
          <strong>Barcode:</strong> ${item.barcode || "N/A"}
        </div>
      </div>

      <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);">
        <div class="location-badge" style="background-color: #0284c7; margin-bottom: 6px;">
          📍 ${item.area || "Basement"} - Sec ${item.section || "N/A"} - Shelf ${item.shelf || "N/A"} (Bin ${item.bin || "N/A"})
        </div>
        
        <div style="font-size: 0.9rem; margin-bottom: 8px;">
          <span style="background: #334155; padding: 2px 6px; border-radius: 4px;">🏷️ ${item.category || "No Category"}</span>
          ${item.stock ? `<span style="background: #334155; padding: 2px 6px; border-radius: 4px; margin-left: 4px;">📦 Qty: ${item.stock}</span>` : ""}
        </div>

        <div class="stock-tag" style="margin-bottom: 8px;">
          Status: ${item.status || "Unknown"}
        </div>

        <!-- Extra details -->
        <div style="font-size: 0.85rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 4px;">
          ${item.supplier ? `<div><strong>Supplier:</strong> ${item.supplier}</div>` : ""}
          ${item.eta ? `<div><strong>ETA:</strong> ${item.eta}</div>` : ""}
          ${item.ssl_barcode ? `<div><strong>SSL Barcode:</strong> ${item.ssl_barcode}</div>` : ""}
          
          <div style="margin-top: 4px; display: flex; gap: 8px;">
            ${item.online ? `<span style="color: #4ade80;">🌐 Online: ${item.online}</span>` : ""}
            ${item.discontinued ? `<span style="color: #f87171;">🚫 Disc: ${item.discontinued}</span>` : ""}
          </div>
        </div>

        ${item.note ? `<div style="font-size: 0.85rem; color: var(--warning); margin-top: 8px;">📝 ${item.note}</div>` : ""}
      </div>
    </div>
  `
    )
    .join("");
}

// ===== 5. SEARCH LOGIC (Searches EVERY column) =====
const searchInput = document.getElementById("searchInput");

searchInput.addEventListener("input", (e) => {
  const query = e.target.value.trim().toLowerCase();

  if (!query) {
    renderItems(inventoryItems);
    return;
  }

  const filtered = inventoryItems.filter((item) => {
    // Combine all your columns into one giant string for searching
    const searchable = [
      item.sku,
      item.description,
      item.barcode,
      item.category,
      item.stock,
      item.status,
      item.eta,
      item.online,
      item.discontinued,
      item.supplier,
      item.area,
      item.shelf,
      item.bin,
      item.ssl_barcode,
      item.note,
      item.section
    ]
      .map((v) => (v == null ? "" : String(v).toLowerCase()))
      .join(" ");

    return searchable.includes(query);
  });

  renderItems(filtered);
});

// ===== 6. INITIAL LOAD =====
fetchInventory();
