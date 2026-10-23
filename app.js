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
  const PAGE_SIZE = 1000; // Supabase max rows per request

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
      if (data.length < PAGE_SIZE) break; // no more pages
      from += PAGE_SIZE;
    }

    inventoryItems = allItems;
    console.log(`✅ Fetched ${inventoryItems.length} inventory rows.`);
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
        ${
          item.image_url
            ? `<img src="${item.image_url}" style="width: 100%; height: 140px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;" />`
            : ""
        }
        <div class="item-title">${item.description || "Unnamed Item"}</div>
        <div class="item-sku">SKU: ${item.sku || "N/A"} | Barcode: ${item.barcode || "N/A"}</div>
      </div>
      <div>
        <div class="location-badge">
          📍 ${item.area || "Basement"} - Shelf ${item.shelf || "N/A"} (Bin ${item.bin || "N/A"})
        </div>
        <div class="stock-tag">Status: ${item.stock_status || "Unknown"}</div>
        ${
          item.note
            ? `<div style="font-size: 0.85rem; color: #94a3b8; margin-top: 6px;">📝 ${item.note}</div>`
            : ""
        }
      </div>
    </div>
  `
    )
    .join("");
}

// ===== 5. SEARCH LOGIC =====
const searchInput = document.getElementById("searchInput");

searchInput.addEventListener("input", (e) => {
  const query = e.target.value.trim().toLowerCase();

  if (!query) {
    renderItems(inventoryItems);
    return;
  }

  const filtered = inventoryItems.filter((item) => {
    // Combine all searchable fields into one string, safely handling nulls/numbers
    const searchable = [
      item.description,
      item.sku,
      item.barcode,
      item.bin,
      item.shelf,
      item.area,
      item.note,
      item.stock_status,
    ]
      .map((v) => (v == null ? "" : String(v).toLowerCase()))
      .join(" ");

    return searchable.includes(query);
  });

  renderItems(filtered);
});

// ===== 6. INITIAL LOAD =====
fetchInventory();
