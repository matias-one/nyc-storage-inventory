// ============================================================
// shared.js — Shared logic across Locator & Admin
// ============================================================

// 1. HTML Escaping
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// 2. ETA Cleaning
function cleanEta(value) {
  if (!value) return "";
  let cleaned = String(value).replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.includes("|")) cleaned = cleaned.split("|")[0].trim();
  const m = cleaned.match(/\b(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\b/);
  return m ? m[1] : (cleaned.split(" ")[0] || cleaned);
}

// 3. Status Badges
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

// 4. Toast Notifications
function showToast(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = "position:fixed; top:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:10px;";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  const bg = type === "error" ? "#ef4444" : type === "warning" ? "#eab308" : "#22c55e";
  const color = type === "warning" ? "#000" : "#fff";
  
  toast.style.cssText = `
    background: ${bg}; color: ${color}; padding: 12px 20px; border-radius: 8px; 
    font-weight: bold; font-size: 0.9rem; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transform: translateX(120%); transition: transform 0.3s ease-out; max-width: 300px;
  `;
  toast.textContent = message;
  
  container.appendChild(toast);
  
  // Animate in
  requestAnimationFrame(() => {
    toast.style.transform = "translateX(0)";
  });

  // Animate out & remove
  setTimeout(() => {
    toast.style.transform = "translateX(120%)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
