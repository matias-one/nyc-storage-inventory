// ===== 1. CONFIGURATION =====
// 👇 REPLACE THESE WITH YOUR OWN SUPABASE URL AND ANON KEY
const SUPABASE_URL = "https://mntgvvmzmmfsbikoidtt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1udGd2dm16bW1mc2Jpa29pZHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTAwNzgsImV4cCI6MjEwODI2NjA3OH0.sbaIcQFm7LjfiqJQHZ1-ZM3EmeIvLEzzfdqEj_Ode8I";

// Initialize Supabase
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== 2. STATE =====
let allAdminItems = [];
let displayedCount = 0;
const BATCH_SIZE = 50;

// ===== 3. DOM ELEMENTS =====
const loginScreen = document.getElementById("loginScreen");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const tableBody = document.getElementById("adminTableBody");
const itemModal = document.getElementById("itemModal");
const itemForm = document.getElementById("itemForm");

// ===== 4. AUTHENTICATION =====
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

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) loginError.textContent = error.message;
  else checkAuth();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await db.auth.signOut();
  checkAuth();
});

// ===== 5. FETCH DATA (WITH PAGINATION FOR ADMIN) =====
async function fetchAllAdminData() {
  tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Loading data...</td></tr>`;
  let allItems = [];
  let from = 0;
  const PAGE_SIZE = 1000;

  try {
    while (true) {
      const { data, error } = await db
        .from("inventory")
        .select("*")
        .order("id", { ascending: false }) // Newest first
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      
      allItems = allItems.concat(data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    allAdminItems = allItems;
    filterAndRenderAdmin();
    
  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center;">Error: ${error.message}</td></tr>`;
  }
}

// ===== 6. FILTER, SEARCH & RENDER =====
function filterAndRenderAdmin() {
  const query = document.getElementById("adminSearchInput").value.trim().toLowerCase();

  const filtered = allAdminItems.filter(item => {
    const searchable = [
      item.sku, item.description, item.barcode, item.category, 
      item.stock, item.status, item.area, item.shelf, item.bin
    ].map(v => (v == null ? "" : String(v).toLowerCase())).join(" ");
    
    return searchable.includes(query);
  });

  displayedCount = 0;
  tableBody.innerHTML = "";
  renderNextAdminBatch(filtered);
}

function renderNextAdminBatch(filteredItems) {
  const loadMoreBtn = document.getElementById("adminLoadMoreBtn");
  
  if (filteredItems.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No items found.</td></tr>`;
    loadMoreBtn.style.display = "none";
    return;
  }

  const nextItems = filteredItems.slice(displayedCount, displayedCount + BATCH_SIZE);
  
  nextItems.forEach(item => {
    // Determine stock button style
    const isStocked = String(item.stock).toLowerCase() === 'yes';
    const stockBtnColor = isStocked ? '#22c55e' : '#ef4444';
    const stockText = isStocked ? 'Yes' : 'No';

    const rowHTML = `
      <tr>
        <td><strong>${item.sku}</strong></td>
        <td>${item.description || "—"}</td>
        <td>
          <!-- NEW: Quick Stock Toggle -->
          <button onclick="toggleStock(${item.id}, '${item.stock || 'No'}')" 
                  style="background: ${stockBtnColor}; color: #000; border: none; padding: 4px 12px; border-radius: 12px; font-weight: bold; cursor: pointer;">
            ${stockText}
          </button>
        </td>
        <td>${item.status || "—"}</td>
        <td>${item.area || ""} ${item.shelf || ""} ${item.bin ? "Bin " + item.bin : ""}</td>
        <td>
          <button onclick="editItem(${item.id})" style="background:none; border:none; cursor:pointer; color: #38bdf8; font-weight:bold; margin-right:10px;">Edit</button>
          <button onclick="deleteItem(${item.id})" class="btn-danger" style="padding: 4px 8px; font-size: 0.8rem;">Delete</button>
        </td>
      </tr>
    `;
    tableBody.insertAdjacentHTML("beforeend", rowHTML);
  });

  displayedCount += nextItems.length;

  // Manage Load More Button state
  if (displayedCount < filteredItems.length) {
    loadMoreBtn.style.display = "inline-block";
    // Remove old listener and add new one to pass the current filtered array
    loadMoreBtn.onclick = () => renderNextAdminBatch(filteredItems);
  } else {
    loadMoreBtn.style.display = "none";
  }
}

// Search Input Listener
let debounceTimer;
document.getElementById("adminSearchInput").addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(filterAndRenderAdmin, 300);
});

// ===== 7. QUICK STOCK TOGGLE =====
window.toggleStock = async (id, currentStock) => {
  const newStock = String(currentStock).toLowerCase() === 'yes' ? 'No' : 'Yes';
  
  // Optimistic UI update (feels instant)
  const { error } = await db.from("inventory").update({ stock: newStock }).eq("id", id);
  
  if (error) {
    alert("Failed to update stock: " + error.message);
  } else {
    // Find the item in local array and update it
    const item = allAdminItems.find(i => i.id === id);
    if (item) item.stock = newStock;
    
    // Re-render only the table (keeps current search active)
    filterAndRenderAdmin();
  }
};

// ===== 8. MODAL LOGIC (ADD / EDIT) =====
document.getElementById("addItemBtn").addEventListener("click", () => {
  itemForm.reset();
  document.getElementById("itemId").value = "";
  document.getElementById("modalTitle").textContent = "Add New Item";
  itemModal.style.display = "flex";
});

document.getElementById("cancelModalBtn").addEventListener("click", () => {
  itemModal.style.display = "none";
});

itemForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const id = document.getElementById("itemId").value;
  const saveBtn = document.getElementById("saveItemBtn");
  saveBtn.textContent = "Saving...";
  saveBtn.disabled = true;

  const itemData = {
    sku: document.getElementById("sku").value,
    description: document.getElementById("description").value,
    barcode: document.getElementById("barcode").value,
    category: document.getElementById("category").value,
    stock: document.getElementById("stock").value,
    status: document.getElementById("status").value,
    area: document.getElementById("area").value,
    shelf: document.getElementById("shelf").value,
    bin: document.getElementById("bin").value,
    image_url: document.getElementById("image_url").value,
  };

  let error;
  if (id) {
    const res = await db.from("inventory").update(itemData).eq("id", id);
    error = res.error;
  } else {
    const res = await db.from("inventory").insert([itemData]);
    error = res.error;
  }

  saveBtn.textContent = "Save Item";
  saveBtn.disabled = false;

  if (error) {
    alert("Error saving item: " + error.message);
  } else {
    itemModal.style.display = "none";
    fetchAllAdminData(); // Reload fresh data from Supabase
  }
});

// ===== 9. GLOBAL EDIT & DELETE =====
window.editItem = async (id) => {
  const { data, error } = await db.from("inventory").select("*").eq("id", id).single();
  if (error || !data) return alert("Could not load item");

  document.getElementById("itemId").value = data.id;
  document.getElementById("sku").value = data.sku || "";
  document.getElementById("description").value = data.description || "";
  document.getElementById("barcode").value = data.barcode || "";
  document.getElementById("category").value = data.category || "";
  document.getElementById("stock").value = data.stock || "Yes";
  document.getElementById("status").value = data.status || "";
  document.getElementById("area").value = data.area || "";
  document.getElementById("shelf").value = data.shelf || "";
  document.getElementById("bin").value = data.bin || "";
  document.getElementById("image_url").value = data.image_url || "";

  document.getElementById("modalTitle").textContent = "Edit Item: " + data.sku;
  itemModal.style.display = "flex";
};

window.deleteItem = async (id) => {
  if (!confirm("Are you sure you want to delete this item? This cannot be undone.")) return;

  const { error } = await db.from("inventory").delete().eq("id", id);
  if (error) alert("Error deleting: " + error.message);
  else fetchAllAdminData();
};

// ===== 10. INIT =====
checkAuth();
