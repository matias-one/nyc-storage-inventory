const SUPABASE_URL = "https://mntgvvmzmmfsbikoidtt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1udGd2dm16bW1mc2Jpa29pZHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTAwNzgsImV4cCI6MjEwODI2NjA3OH0.sbaIcQFm7LjfiqJQHZ1-ZM3EmeIvLEzzfdqEj_Ode8I"; // keep yours

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let inventoryItems = [];

const PAGE_SIZE = 1000; // Supabase returns at most 1000 rows per request

async function fetchInventory() {
  const itemListElement = document.getElementById("itemList");
  let all = [];
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from("inventory")
      .select("*")
      .order("id", { ascending: true }) // change "id" if your PK has another name
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("Error loading Supabase data:", error);
      itemListElement.innerHTML = `<p style="color:red; text-align:center;">Failed to connect to Supabase: ${error.message}</p>`;
      return;
    }

    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  inventoryItems = all;
  console.log(`Fetched ${inventoryItems.length} rows. Sample row:`, inventoryItems[0]);
  renderItems(inventoryItems);
}

function renderItems(items) {
  const container = document.getElementById("itemList");

  if (items.length === 0) {
    container.innerHTML = `<p style="text-align:center; color: var(--text-muted);">No items found.</p>`;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="item-card">
      <div>
        ${item.image_url ? `<img src="${item.image_url}" style="width: 100%; height: 140px; object-fit: cover; border-radius: 8px; margin-bottom: 10px;" />` : ''}
        <div class="item-title">${item.description || 'Unnamed Item'}</div>
        <div class="item-sku">SKU: ${item.sku || 'N/A'} | Barcode: ${item.barcode || 'N/A'}</div>
      </div>
      <div>
        <div class="location-badge">
          📍 ${item.area || 'Basement'} - Shelf ${item.shelf || 'N/A'} (Bin ${item.bin || 'N/A'})
        </div>
        <div class="stock-tag">Status: ${item.stock_status || 'Unknown'}</div>
        ${item.note ? `<div style="font-size: 0.85rem; color: #94a3b8; margin-top: 6px;">📝 ${item.note}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ---- Search: checks EVERY field shown on the card, and survives numbers ----
const toText = (value) =>
  value === null || value === undefined ? "" : String(value).toLowerCase();

document.getElementById("searchInput").addEventListener("input", (e) => {
  const query = e.target.value.trim().toLowerCase();

  const filtered = !query
    ? inventoryItems
    : inventoryItems.filter((item) =>
        [
          item.description, item.sku, item.barcode,
          item.bin, item.shelf, item.area, item.note, item.stock_status,
        ]
          .map(toText)
          .join(" ")
          .includes(query)
      );

  renderItems(filtered);
});

fetchInventory();
