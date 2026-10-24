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
let lockedShelf = null;
let nextBin = null;

// ===== 3. DOM ELEMENTS =====
const loginScreen = document.getElementById("loginScreen");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const tableBody = document.getElementById("adminTableBody");
const itemModal = document.getElementById("itemModal");
const itemForm = document.getElementById("itemForm");

// Mapper Elements
const mapperItemInput = document.getElementById("mapper-item-input");
const mapperResults = document.getElementById("mapper-results");
const mapperLog = document.getElementById("mapper-status-log");

// ===== 4. TAB SWITCHING =====
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

// ===== 5. AUTHENTICATION =====
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

// ===== 6. MASTER TABLE LOGIC (From previous step) =====
async function fetchAllAdminData() {
  tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Loading data...</td></tr>`;
  const { data, error } = await db.from("inventory").select("*").order("id", { ascending: false }).limit(1000);
  
  if (error) {
    tableBody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">Error: ${error.message}</td></tr>`;
    return;
  }
  allAdminItems = data;
  filterAndRenderAdmin();
}

function filterAndRenderAdmin() {
  const query = document.getElementById("adminSearchInput").value.trim().toLowerCase();
  const filtered = allAdminItems.filter(item => {
    const searchable = [item.sku, item.description, item.barcode, item.category, item.status, item.shelf].map(v => String(v || "")).join(" ").toLowerCase();
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
    const isStocked = String(item.stock).toLowerCase() === 'yes';
    const rowHTML = `
      <tr>
        <td><strong>${item.sku}</strong></td>
        <td>${item.description || "—"}</td>
        <td>
          <button onclick="toggleStock(${item.id}, '${item.stock || 'No'}')" 
                  style="background: ${isStocked ? '#22c55e' : '#ef4444'}; color: #000; border: none; padding: 4px 12px; border-radius: 12px; font-weight: bold; cursor: pointer;">
            ${isStocked ? 'Yes' : 'No'}
          </button>
        </td>
        <td>${item.area || ""} ${item.shelf || ""} ${item.bin ? "Bin " + item.bin : ""}</td>
        <td>
          <button onclick="editItem(${item.id})" style="background:none; border:none; cursor:pointer; color: #38bdf8; font-weight: bold;">Edit</button>
        </td>
      </tr>
    `;
    tableBody.insertAdjacentHTML("beforeend", rowHTML);
  });
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

// ===== 7. SHELF MAPPER LOGIC =====
document.getElementById("shelf-lock-input").addEventListener("change", async (e) => {
  const shelfVal = e.target.value.trim().toUpperCase();
  const areaVal = document.getElementById("shelf-area-input").value.trim();
  const sectionVal = document.getElementById("shelf-section-input").value.trim();
  
  if (!shelfVal) return;

  // Fetch current items on this shelf to find the max bin
  const { data, error } = await db.from("inventory").select("bin").eq("shelf", shelfVal);
  
  if (error) return alert("Error locking shelf");

  let maxBin = 0;
  if (data && data.length > 0) {
    data.forEach(row => {
      const b = parseInt(row.bin);
      if (!isNaN(b) && b > maxBin) maxBin = b;
    });
  }

  lockedShelf = shelfVal;
  nextBin = maxBin + 1;

  // Update UI
  document.getElementById("shelf-lock-input").disabled = true;
  document.getElementById("shelf-area-input").disabled = true;
  document.getElementById("shelf-section-input").disabled = true;
  
  document.getElementById("unlock-shelf-btn").style.display = "inline-block";
  document.getElementById("shelf-info-display").style.display = "block";
  document.getElementById("active-shelf-label").textContent = lockedShelf;
  document.getElementById("next-bin-label").textContent = String(nextBin).padStart(2, '0');
  
  const scanSection = document.getElementById("item-scan-section");
  scanSection.style.opacity = "1";
  scanSection.style.pointerEvents = "auto";
  mapperItemInput.focus();
  
  updateLog(`Shelf ${lockedShelf} locked. Next bin: ${nextBin}`, "var(--accent)");
});

document.getElementById("unlock-shelf-btn").addEventListener("click", () => {
  lockedShelf = null;
  nextBin = null;
  document.getElementById("shelf-lock-input").disabled = false;
  document.getElementById("shelf-lock-input").value = "";
  document.getElementById("shelf-area-input").disabled = false;
  document.getElementById("shelf-area-input").value = "";
  document.getElementById("shelf-section-input").disabled = false;
  document.getElementById("shelf-section-input").value = "";
  
  document.getElementById("unlock-shelf-btn").style.display = "none";
  document.getElementById("shelf-info-display").style.display = "none";
  
  const scanSection = document.getElementById("item-scan-section");
  scanSection.style.opacity = "0.5";
  scanSection.style.pointerEvents = "none";
  mapperItemInput.value = "";
  mapperResults.innerHTML = "";
  
  updateLog("Shelf unlocked. Ready for next location.", "var(--text-muted)");
});

// Search for items to assign
mapperItemInput.addEventListener("input", async (e) => {
  const query = e.target.value.trim().toLowerCase();
  if (query.length < 2) {
    mapperResults.innerHTML = "";
    return;
  }

  // Search Supabase directly to ensure fresh data
  const { data, error } = await db.from("inventory")
    .select("id, sku, description, barcode, ssl_barcode, shelf, bin")
    .or(`sku.ilike.%${query}%,description.ilike.%${query}%,barcode.ilike.%${query}%`)
    .limit(10);

  if (error || !data) return;

  mapperResults.innerHTML = data.map(item => `
    <div class="mapper-item-card">
      <div class="mapper-item-info">
        <div class="mapper-item-title">${item.description}</div>
        <div class="mapper-item-sku">SKU: ${item.sku} ${item.barcode ? `| BC: ${item.barcode}` : ''}</div>
        ${item.shelf ? `<div style="font-size: 0.75rem; color: var(--warning); margin-top: 4px;">Currently at: ${item.shelf} - Bin ${item.bin}</div>` : ''}
      </div>
      
      <div class="mapper-actions">
        <button onclick="assignToShelf('${item.sku}')" class="btn-primary" style="padding: 6px 12px; font-size: 0.8rem;">Assign</button>
        <input type="text" placeholder="SSL Barcode" value="${item.ssl_barcode || ''}" onchange="updateSsl('${item.sku}', this.value)" style="padding: 4px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-dark); color: white; width: 110px;" />
      </div>
    </div>
  `).join("");
});

// Assign Function
window.assignToShelf = async (sku) => {
  updateLog(`Assigning ${sku}...`, "var(--warning)");
  
  const areaVal = document.getElementById("shelf-area-input").value.trim();
  const sectionVal = document.getElementById("shelf-section-input").value.trim();
  const binStr = String(nextBin).padStart(2, '0');

  const { error } = await db.from("inventory").update({
    shelf: lockedShelf,
    bin: binStr,
    area: areaVal || null,
    section: sectionVal || null
  }).eq("sku", sku);

  if (error) {
    updateLog("Error assigning item!", "#ef4444");
    alert(error.message);
  } else {
    updateLog(`✅ Assigned ${sku} to Bin ${binStr}`, "var(--success)");
    nextBin++;
    document.getElementById("next-bin-label").textContent = String(nextBin).padStart(2, '0');
    mapperItemInput.value = "";
    mapperResults.innerHTML = "";
    mapperItemInput.focus();
  }
};

// Update SSL Barcode Inline
window.updateSsl = async (sku, barcode) => {
  const { error } = await db.from("inventory").update({ ssl_barcode: barcode }).eq("sku", sku);
  if (error) {
    alert("Error updating SSL");
  } else {
    updateLog(`🔗 SSL Barcode linked to ${sku}`, "var(--accent)");
  }
};

function updateLog(msg, color) {
  mapperLog.textContent = msg;
  mapperLog.style.color = color;
}

// ===== 8. QR CODE GENERATOR =====
let qrInstance = null;
document.getElementById("qr-toggle-btn").addEventListener("click", () => {
  const panel = document.getElementById("qr-panel");
  const shelfId = document.getElementById("shelf-lock-input").value.trim().toUpperCase() || "SCAN-SHELF";
  
  if (panel.style.display === "none") {
    panel.style.display = "block";
    document.getElementById("qr-code-display").innerHTML = "";
    qrInstance = new QRCode(document.getElementById("qr-code-display"), {
      text: shelfId,
      width: 128,
      height: 128,
      correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    panel.style.display = "none";
  }
});

document.getElementById("print-qr-btn").addEventListener("click", () => {
  const shelfId = document.getElementById("shelf-lock-input").value.trim().toUpperCase();
  if (!shelfId) return alert("Type a shelf ID first.");
  
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`
    <html><head><title>Label ${shelfId}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <style>
      @page { margin: 0; }
      body { margin:0; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif; }
      #qr { margin-bottom: 20px; }
    </style></head>
    <body>
      <div id="qr"></div>
      <h1 style="font-size: 40px; font-weight: 900; margin: 0;">${shelfId}</h1>
      <script>
        new QRCode(document.getElementById("qr"), { text: "${shelfId}", width: 300, height: 300 });
        setTimeout(() => { window.print(); window.close(); }, 800);
      <\/script>
    </body></html>
  `);
  printWindow.document.close();
});

// ===== 9. INIT =====
checkAuth();
