// ===== 1. CONFIGURATION =====
const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY_HERE";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== 2. DOM ELEMENTS =====
const loginScreen = document.getElementById("loginScreen");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const tableBody = document.getElementById("adminTableBody");
const itemModal = document.getElementById("itemModal");
const itemForm = document.getElementById("itemForm");

// ===== 3. AUTHENTICATION =====
async function checkAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    loginScreen.style.display = "none";
    dashboard.style.display = "block";
    loadInventoryTable();
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

  const { data, error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    loginError.textContent = error.message;
  } else {
    checkAuth();
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await db.auth.signOut();
  checkAuth();
});

// ===== 4. LOAD DATA INTO TABLE =====
async function loadInventoryTable() {
  tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Loading data...</td></tr>`;
  
  const { data, error } = await db
    .from("inventory")
    .select("*")
    .order("id", { ascending: false }) // Show newest first
    .limit(100); // Limit to 100 for the admin view for performance

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center;">Error: ${error.message}</td></tr>`;
    return;
  }

  if (data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No items found.</td></tr>`;
    return;
  }

  tableBody.innerHTML = data.map(item => `
    <tr>
      <td><strong>${item.sku}</strong></td>
      <td>${item.description || "—"}</td>
      <td>${item.stock || "—"}</td>
      <td>${item.status || "—"}</td>
      <td>${item.area || ""} ${item.shelf || ""} ${item.bin ? "Bin " + item.bin : ""}</td>
      <td>
        <button onclick="editItem(${item.id})" style="background:none; border:none; cursor:pointer; color: #38bdf8; font-weight:bold; margin-right:10px;">Edit</button>
        <button onclick="deleteItem(${item.id})" class="btn-danger" style="padding: 4px 8px; font-size: 0.8rem;">Delete</button>
      </td>
    </tr>
  `).join("");
}

// ===== 5. MODAL LOGIC (ADD / EDIT) =====
document.getElementById("addItemBtn").addEventListener("click", () => {
  itemForm.reset();
  document.getElementById("itemId").value = "";
  document.getElementById("modalTitle").textContent = "Add New Item";
  itemModal.style.display = "flex";
});

document.getElementById("cancelModalBtn").addEventListener("click", () => {
  itemModal.style.display = "none";
});

// Save Item (Insert or Update)
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
    // Update existing
    const res = await db.from("inventory").update(itemData).eq("id", id);
    error = res.error;
  } else {
    // Insert new
    const res = await db.from("inventory").insert([itemData]);
    error = res.error;
  }

  saveBtn.textContent = "Save Item";
  saveBtn.disabled = false;

  if (error) {
    alert("Error saving item: " + error.message);
  } else {
    itemModal.style.display = "none";
    loadInventoryTable(); // Refresh the table
  }
});

// ===== 6. GLOBAL EDIT & DELETE FUNCTIONS =====
window.editItem = async (id) => {
  // Fetch the specific item to ensure we have latest data
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
  if (error) {
    alert("Error deleting: " + error.message);
  } else {
    loadInventoryTable();
  }
};

// ===== 7. INIT =====
checkAuth();
