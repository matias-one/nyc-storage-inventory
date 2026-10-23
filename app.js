// Paste your Supabase Project details here
const SUPABASE_URL = "https://mntgvvmzmmfsbikoidtt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1udGd2dm16bW1mc2Jpa29pZHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTAwNzgsImV4cCI6MjEwODI2NjA3OH0.sbaIcQFm7LjfiqJQHZ1-ZM3EmeIvLEzzfdqEj_Ode8I";

// Initialize Supabase Client
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let inventoryItems = [];

// Fetch items from Supabase when page loads
async function fetchInventory() {
  const itemListElement = document.getElementById("itemList");

  const { data, error } = await supabase
    .from('inventory')
    .select('*');

  if (error) {
    console.error("Error loading Supabase data:", error);
    itemListElement.innerHTML = `<p style="color:red; text-align:center;">Failed to connect to Supabase. Check app.js configuration.</p>`;
    return;
  }

  inventoryItems = data || [];
  renderItems(inventoryItems);
}

// Render inventory list into HTML cards
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

// Search Filter Logic across Description, SKU, and Barcode
document.getElementById("searchInput").addEventListener("input", (e) => {
  const query = e.target.value.toLowerCase();
  const filtered = inventoryItems.filter(item => 
    (item.description && item.description.toLowerCase().includes(query)) ||
    (item.sku && item.sku.toLowerCase().includes(query)) ||
    (item.barcode && item.barcode.toLowerCase().includes(query)) ||
    (item.shelf && item.shelf.toLowerCase().includes(query))
  );
  renderItems(filtered);
});

// Run load on start
fetchInventory();