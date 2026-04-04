// ============================================================
// admin.js — Admin Dashboard JavaScript
// Covers: products, orders, customers, discounts,
//         finance (inventory, prices, receivables, payables, expenses),
//         and store settings (points, QR code)
// ============================================================

// ── Module-level customer cache (avoids JSON-in-onclick) ─────
let _customers = [];

// ── HTML escape helper ────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Image lightbox ────────────────────────────────────────────
function openImageModal(url) {
  const lb = document.getElementById('img-lightbox');
  if (!lb || !url) return;
  document.getElementById('img-lightbox-img').src = url;
  lb.classList.add('open');
}
function closeImageModal() {
  const lb = document.getElementById('img-lightbox');
  if (lb) lb.classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeImageModal(); });

// ── On page load ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkAdminAccess();  // redirect away if not admin
  loadInventory();           // default tab
  loadAdminOrders();
  loadAdminDiscounts();
});

// ── checkAdminAccess() ────────────────────────────────────────
async function checkAdminAccess() {
  try {
    const res  = await fetch('/api/admin/check', { credentials: 'include' });
    const data = await res.json();
    if (!data.isAdmin) window.location.href = 'login.html';
  } catch {
    window.location.href = 'login.html';
  }
}

async function adminLogout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  window.location.href = 'index.html';
}


// ════════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════════

let _customersPollingTimer = null;

function switchTab(tab) {
  const tabs = ['inventory','orders','customers','finance','settings'];
  tabs.forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`panel-${t}`).style.display = t === tab ? '' : 'none';
  });

  // Stop any previous customers auto-refresh
  if (_customersPollingTimer) { clearInterval(_customersPollingTimer); _customersPollingTimer = null; }

  // Load data for the selected tab
  if (tab === 'inventory') loadInventory();
  if (tab === 'orders')    loadAdminOrders();
  if (tab === 'customers') {
    loadAdminCustomers();
    // Auto-refresh every 20 seconds while on this tab so name changes show without manual refresh
    _customersPollingTimer = setInterval(loadAdminCustomers, 20000);
  }
  if (tab === 'finance')   { switchFinTab('overview'); loadFinanceOverview(); }
  if (tab === 'settings')  loadSettings();
}


// ════════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════════

async function loadInventory() {
  const el = document.getElementById('inventory-content');
  el.innerHTML = `<p class="admin-loading">Loading...</p>`;
  try {
    const res      = await fetch('/api/products', { credentials: 'include' });
    const products = await res.json();

    if (!products.length) {
      el.innerHTML = '<p class="admin-empty">No products yet. Click "+ Add Product" to get started.</p>';
      return;
    }

    const inventoryValue = products.reduce((s, p) => s + ((p.costPrice || 0) * (p.stockQuantity || 0)), 0);

    el.innerHTML = `
      <div style="padding:14px 24px 8px;font-size:0.9rem;color:var(--text-light)">
        Total Inventory Value: <strong style="color:var(--primary)">₱${fmt(inventoryValue)}</strong>
        &nbsp;·&nbsp; <span style="font-size:0.8rem">⚠️ qty ≤ 5 = low stock</span>
      </div>
      <div class="admin-table-scroll"><table class="admin-table">
        <thead><tr>
          <th>Photo</th><th>Product</th><th>Category</th><th>Stock</th>
          <th>Cost (₱)</th><th>Sell (₱)</th><th>Margin</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${products.map(p => {
            const imgs   = p.images && p.images.length ? p.images : [p.image];
            const stock  = p.stockQuantity !== undefined ? p.stockQuantity : 0;
            const cost   = parseFloat(p.costPrice || 0);
            const sell   = parseFloat(p.price || 0);
            const low    = typeof stock === 'number' && stock <= 5;
            const margin = sell > 0 && cost > 0 ? ((sell - cost) / sell * 100).toFixed(1) : '—';
            const marginColor = margin !== '—'
              ? (parseFloat(margin) < 20 ? '#dc3545' : parseFloat(margin) < 40 ? '#ffc107' : '#28a745')
              : 'var(--text-light)';
            return `
              <tr class="${low ? 'low-stock-row' : ''}">
                <td>
                  <div class="admin-img-preview-row" style="gap:4px">
                    ${imgs.slice(0,1).map(src => `
                      <img src="${src}" alt="${p.name}" class="admin-product-thumb"
                        onerror="this.style.background='#e8f5e8';this.src=''" />`).join('')}
                  </div>
                </td>
                <td>
                  <strong>${p.name}</strong>
                  ${low ? '<br><span class="low-stock-badge">Low Stock</span>' : ''}
                </td>
                <td style="font-size:0.85rem;color:var(--text-light)">${p.category || '—'}</td>
                <td>${stock}</td>
                <td class="admin-price-cell">₱${cost.toFixed(2)}</td>
                <td class="admin-price-cell">₱${sell.toFixed(2)}</td>
                <td><span style="color:${marginColor};font-weight:700">${margin !== '—' ? margin + '%' : '—'}</span></td>
                <td class="admin-actions-cell">
                  <button class="btn btn-small admin-edit-btn" onclick="openEditModal('${p.id}')">✏️ Edit</button>
                  <button class="btn btn-small admin-delete-btn" onclick="deleteProduct('${p.id}','${p.name.replace(/'/g,"\\'")}')">🗑️</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
  } catch {
    el.innerHTML = '<p class="admin-empty">Could not load inventory.</p>';
  }
}

// ── Admin photo carousel state ───────────────────────────
// Each entry: { display: string (URL or dataURL), path: string|null, file: File|null }
let _adminPhotos = [];
let _adminCarouselIdx = 0;

function _renderAdminCarousel() {
  const carousel = document.getElementById('admin-photo-carousel');
  const thumbWrap = document.getElementById('admin-photo-thumbs');
  const img      = document.getElementById('admin-carousel-img');
  const counter  = document.getElementById('admin-carousel-counter');
  const btnL     = carousel.querySelector('.carousel-btn-left');
  const btnR     = carousel.querySelector('.carousel-btn-right');

  if (!_adminPhotos.length) {
    carousel.style.display  = 'none';
    thumbWrap.style.display = 'none';
    document.getElementById('product-file-text').style.display = '';
    return;
  }

  // Clamp index
  if (_adminCarouselIdx >= _adminPhotos.length) _adminCarouselIdx = _adminPhotos.length - 1;

  carousel.style.display  = '';
  thumbWrap.style.display = '';
  document.getElementById('product-file-text').style.display = 'none';

  img.src = _adminPhotos[_adminCarouselIdx].display;
  counter.textContent = `${_adminCarouselIdx + 1}/${_adminPhotos.length}`;
  btnL.style.display = _adminPhotos.length > 1 ? '' : 'none';
  btnR.style.display = _adminPhotos.length > 1 ? '' : 'none';

  // Rebuild thumbnail strip
  thumbWrap.innerHTML = '';
  _adminPhotos.forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'admin-photo-thumb-wrap' + (i === _adminCarouselIdx ? ' active' : '');

    const thumb = document.createElement('img');
    thumb.src = p.display;
    thumb.className = 'admin-photo-thumb';
    thumb.onclick = () => { _adminCarouselIdx = i; _renderAdminCarousel(); };

    const controls = document.createElement('div');
    controls.className = 'admin-thumb-controls';

    const btnLeft = document.createElement('button');
    btnLeft.type = 'button'; btnLeft.textContent = '←'; btnLeft.title = 'Move left';
    btnLeft.disabled = i === 0;
    btnLeft.onclick = () => { _adminPhotoMove(i, -1); };

    const btnRight = document.createElement('button');
    btnRight.type = 'button'; btnRight.textContent = '→'; btnRight.title = 'Move right';
    btnRight.disabled = i === _adminPhotos.length - 1;
    btnRight.onclick = () => { _adminPhotoMove(i, 1); };

    const btnDel = document.createElement('button');
    btnDel.type = 'button'; btnDel.textContent = '✕'; btnDel.title = 'Remove';
    btnDel.className = 'admin-thumb-remove';
    btnDel.onclick = () => { _adminPhotoRemove(i); };

    controls.append(btnLeft, btnRight, btnDel);
    wrap.append(thumb, controls);
    thumbWrap.appendChild(wrap);
  });
}

function _adminPhotoMove(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= _adminPhotos.length) return;
  [_adminPhotos[i], _adminPhotos[j]] = [_adminPhotos[j], _adminPhotos[i]];
  _adminCarouselIdx = j;
  _renderAdminCarousel();
}

function _adminPhotoRemove(i) {
  _adminPhotos.splice(i, 1);
  if (_adminCarouselIdx >= _adminPhotos.length) _adminCarouselIdx = Math.max(0, _adminPhotos.length - 1);
  _renderAdminCarousel();
}

function adminCarouselNav(dir) {
  if (!_adminPhotos.length) return;
  _adminCarouselIdx = (_adminCarouselIdx + dir + _adminPhotos.length) % _adminPhotos.length;
  _renderAdminCarousel();
}

function openProductModal() {
  document.getElementById('product-modal-title').textContent    = 'Add New Product';
  document.getElementById('product-id').value                   = '';
  document.getElementById('product-name').value                 = '';
  document.getElementById('product-desc').value                 = '';
  document.getElementById('product-category').value             = '';
  document.getElementById('product-price').value                = '';
  document.getElementById('product-cost').value                 = '';
  document.getElementById('product-stock').value                = '';
  document.getElementById('product-images').value               = '';
  _adminPhotos = []; _adminCarouselIdx = 0;
  _renderAdminCarousel();
  document.getElementById('product-form-error').style.display   = 'none';
  document.getElementById('photo-optional-label').textContent   = '(optional)';
  document.getElementById('price-tiers-container').innerHTML    = '';
  document.getElementById('variants-container').innerHTML       = '';
  document.getElementById('product-save-btn').textContent       = 'Save Product';
  document.getElementById('product-save-btn').disabled         = false;
  document.getElementById('product-modal').classList.add('open');
  document.getElementById('product-modal-overlay').classList.add('open');
}

async function openEditModal(productId) {
  try {
    const res      = await fetch('/api/products', { credentials: 'include' });
    const products = await res.json();
    const p        = products.find(x => x.id === productId);
    if (!p) { alert('Product not found.'); return; }

    document.getElementById('product-modal-title').textContent    = 'Edit Product';
    document.getElementById('product-id').value                   = p.id;
    document.getElementById('product-name').value                 = p.name;
    document.getElementById('product-desc').value                 = p.description;
    document.getElementById('product-category').value             = p.category || '';
    document.getElementById('product-price').value                = p.price;
    document.getElementById('product-cost').value                 = p.costPrice || '';
    document.getElementById('product-stock').value                = p.stockQuantity !== undefined ? p.stockQuantity : '';
    document.getElementById('product-form-error').style.display   = 'none';
    document.getElementById('photo-optional-label').textContent   = '(keep current if blank)';
    document.getElementById('product-save-btn').textContent       = 'Update Product';
    document.getElementById('product-save-btn').disabled         = false;

    const existingImages = p.images && p.images.length ? p.images : (p.image ? [p.image] : []);
    _adminPhotos      = existingImages.map(src => ({ display: src, path: src, file: null }));
    _adminCarouselIdx = 0;
    _renderAdminCarousel();
    document.getElementById('product-images').value = '';

    document.getElementById('price-tiers-container').innerHTML = '';
    (p.priceTiers || []).forEach(t => addTierRow(t.minQty, t.price));
    document.getElementById('variants-container').innerHTML = '';
    (p.variants || []).forEach(v => addVariantRow(v.name, v.price));

    document.getElementById('product-modal').classList.add('open');
    document.getElementById('product-modal-overlay').classList.add('open');
  } catch (err) {
    alert('Could not load product: ' + (err.message || 'Unknown error'));
  }
}

function closeProductModal() {
  document.getElementById('product-modal').classList.remove('open');
  document.getElementById('product-modal-overlay').classList.remove('open');
}

let tierRowCount = 0;
function addTierRow(minQty = '', price = '') {
  const id  = tierRowCount++;
  const row = document.createElement('div');
  row.className = 'tier-row'; row.id = `tier-row-${id}`;
  row.innerHTML = `
    <input type="number" class="tier-minqty" placeholder="Min Qty" value="${minQty}" min="1" />
    <input type="number" class="tier-price"  placeholder="Price ₱" value="${price}" min="0" step="0.01" />
    <button type="button" class="tier-remove-btn" onclick="removeTierRow('tier-row-${id}')">✕</button>`;
  document.getElementById('price-tiers-container').appendChild(row);
}
function removeTierRow(id) { const el = document.getElementById(id); if(el) el.remove(); }
function collectTiers() {
  return [...document.querySelectorAll('#price-tiers-container .tier-row')]
    .map(r => ({ minQty: parseInt(r.querySelector('.tier-minqty').value), price: parseFloat(r.querySelector('.tier-price').value) }))
    .filter(t => !isNaN(t.minQty) && !isNaN(t.price))
    .sort((a,b) => a.minQty - b.minQty);
}

let variantRowCount = 0;
function addVariantRow(name = '', price = '') {
  const id  = variantRowCount++;
  const row = document.createElement('div');
  row.className = 'tier-row'; row.id = `variant-row-${id}`;
  row.innerHTML = `
    <input type="text"   class="variant-name"  placeholder='e.g. "Small"' value="${name}" />
    <input type="number" class="variant-price" placeholder="Price ₱" value="${price}" min="0" step="0.01" />
    <button type="button" class="tier-remove-btn" onclick="removeVariantRow('variant-row-${id}')">✕</button>`;
  document.getElementById('variants-container').appendChild(row);
}
function removeVariantRow(id) { const el = document.getElementById(id); if(el) el.remove(); }
function collectVariants() {
  return [...document.querySelectorAll('#variants-container .tier-row')]
    .map(r => ({ name: r.querySelector('.variant-name').value.trim(), price: parseFloat(r.querySelector('.variant-price').value) }))
    .filter(v => v.name && !isNaN(v.price));
}

function previewProductImages(input) {
  if (!input.files.length) return;
  const files = [...input.files];
  // Check total limit
  if (_adminPhotos.length + files.length > 10) {
    alert(`You can only have up to 10 photos. Currently have ${_adminPhotos.length}, tried to add ${files.length}.`);
    input.value = '';
    return;
  }
  let loaded = 0;
  const newEntries = new Array(files.length);
  files.forEach((file, i) => {
    const reader = new FileReader();
    reader.onload = e => {
      newEntries[i] = { display: e.target.result, path: null, file };
      loaded++;
      if (loaded === files.length) {
        _adminPhotos.push(...newEntries);
        _adminCarouselIdx = _adminPhotos.length - newEntries.length; // jump to first new
        _renderAdminCarousel();
        input.value = ''; // reset so same files can be re-added after removal
      }
    };
    reader.readAsDataURL(file);
  });
}

async function saveProduct(event) {
  event.preventDefault();
  const id       = document.getElementById('product-id').value;
  const errorBox = document.getElementById('product-form-error');
  const saveBtn  = document.getElementById('product-save-btn');
  errorBox.style.display = 'none'; saveBtn.disabled = true; saveBtn.textContent = 'Saving...';

  const formData = new FormData();
  formData.append('name',        document.getElementById('product-name').value.trim());
  formData.append('description', document.getElementById('product-desc').value.trim());
  formData.append('category',    document.getElementById('product-category').value.trim());
  formData.append('price',       document.getElementById('product-price').value);
  formData.append('costPrice',   document.getElementById('product-cost').value || '0');
  formData.append('stockQuantity', document.getElementById('product-stock').value || '0');
  formData.append('priceTiers',  JSON.stringify(collectTiers()));
  formData.append('variants',    JSON.stringify(collectVariants()));
  const existingPaths = _adminPhotos.filter(p => p.path).map(p => p.path);
  formData.append('existingImages', JSON.stringify(existingPaths));
  _adminPhotos.filter(p => p.file).forEach(p => formData.append('images', p.file));

  const isEditing = !!id;
  const url    = isEditing ? `/api/admin/products/${id}` : '/api/admin/products';
  const method = isEditing ? 'PUT' : 'POST';

  const safetyTimer = setTimeout(() => {
    saveBtn.disabled = false;
    saveBtn.textContent = isEditing ? 'Update Product' : 'Save Product';
    errorBox.textContent   = 'Server is not responding. Is the server running?';
    errorBox.style.display = '';
  }, 10000);

  try {
    const res  = await fetch(url, { method, credentials: 'include', body: formData });
    clearTimeout(safetyTimer);
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      errorBox.textContent   = data.error || `Server error ${res.status}.`;
      errorBox.style.display = '';
      saveBtn.disabled = false; saveBtn.textContent = isEditing ? 'Update Product' : 'Save Product';
      return;
    }
    closeProductModal();
    loadInventory();
  } catch (err) {
    clearTimeout(safetyTimer);
    errorBox.textContent   = err.message || 'Cannot reach server.';
    errorBox.style.display = '';
    saveBtn.disabled = false; saveBtn.textContent = isEditing ? 'Update Product' : 'Save Product';
  }
}

async function deleteProduct(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const res = await fetch(`/api/admin/products/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) loadInventory();
  else alert('Could not delete product.');
}


// ════════════════════════════════════════════════════════════
// ORDERS
// ════════════════════════════════════════════════════════════

async function loadAdminOrders() {
  const wrap  = document.getElementById('orders-table-wrap');
  const badge = document.getElementById('order-count-badge');

  try {
    const res    = await fetch('/api/admin/orders', { credentials: 'include' });
    const orders = await res.json();

    badge.textContent   = orders.length;
    badge.style.display = orders.length ? '' : 'none';

    if (!orders.length) { wrap.innerHTML = '<p class="admin-empty">No orders yet.</p>'; return; }
    orders.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    wrap.innerHTML = `<div class="admin-table-scroll">
      <table class="admin-table orders-table">
        <thead><tr>
          <th>Date</th><th>Customer</th><th>Contact</th><th>Address</th>
          <th>Items</th><th>Total</th><th>Screenshot</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>
          ${orders.map(o => `
            <tr id="order-row-${o.id}">
              <td class="date-cell">${formatDate(o.createdAt)}</td>
              <td><strong>${o.customerName}</strong></td>
              <td>${o.contact}</td>
              <td class="address-cell">${o.address}</td>
              <td class="items-cell">${o.items.map(i => `${i.name} ×${i.qty}`).join('<br/>')}</td>
              <td class="admin-price-cell">₱${parseFloat(o.total).toFixed(2)}</td>
              <td>
                <img src="${o.paymentScreenshot.startsWith('http') ? o.paymentScreenshot : '/' + o.paymentScreenshot}" alt="Payment" class="payment-thumb"
                  onclick="viewScreenshot('${o.paymentScreenshot.startsWith('http') ? o.paymentScreenshot : '/' + o.paymentScreenshot}')"
                  title="Click to view full screenshot" />
              </td>
              <td>
                <select class="status-select status-${o.status}"
                  onchange="updateOrderStatus('${o.id}', this)">
                  <option value="pending"   ${o.status==='pending'   ?'selected':''}>⏳ Pending</option>
                  <option value="confirmed" ${o.status==='confirmed' ?'selected':''}>✅ Confirmed</option>
                  <option value="shipped"   ${o.status==='shipped'   ?'selected':''}>🚚 Shipped</option>
                  <option value="delivered" ${o.status==='delivered' ?'selected':''}>📬 Delivered</option>
                  <option value="cancelled" ${o.status==='cancelled' ?'selected':''}>❌ Cancelled</option>
                </select>
              </td>
              <td>
                <button class="btn btn-small admin-delete-btn" onclick="deleteOrder('${o.id}')">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch {
    wrap.innerHTML = '<p class="admin-empty">Could not load orders.</p>';
  }
}

async function updateOrderStatus(orderId, selectEl) {
  selectEl.className = `status-select status-${selectEl.value}`;
  await fetch(`/api/admin/orders/${orderId}/status`, {
    method: 'PUT', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: selectEl.value })
  });
}

async function deleteOrder(orderId) {
  if (!confirm('Delete this order? This cannot be undone.')) return;
  const res = await fetch(`/api/admin/orders/${orderId}`, {
    method: 'DELETE', credentials: 'include'
  });
  if (res.ok) {
    document.getElementById(`order-row-${orderId}`)?.remove();
    // Update badge count
    const badge = document.getElementById('order-count-badge');
    const remaining = document.querySelectorAll('#orders-table-wrap tbody tr').length;
    badge.textContent   = remaining;
    badge.style.display = remaining ? '' : 'none';
  } else {
    alert('Could not delete order.');
  }
}

function viewScreenshot(src) {
  document.getElementById('screenshot-full').src = src;
  document.getElementById('screenshot-viewer').style.display = '';
  document.getElementById('screenshot-overlay').classList.add('open');
}
function closeScreenshot() {
  document.getElementById('screenshot-viewer').style.display = 'none';
  document.getElementById('screenshot-overlay').classList.remove('open');
}


// ════════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════════

async function loadPendingApprovals() {
  const wrap  = document.getElementById('pending-approvals-wrap');
  const list  = document.getElementById('pending-list');
  const badge = document.getElementById('customer-count-badge');
  try {
    const res     = await fetch('/api/admin/users/pending', { credentials: 'include' });
    const pending = await res.json();

    if (!pending.length) {
      wrap.style.display = 'none';
      return;
    }

    // Show badge with pending count
    badge.textContent   = pending.length;
    badge.style.display = '';

    wrap.style.display = '';
    list.innerHTML = `<div class="admin-table-scroll">
      <table class="admin-table">
        <thead><tr><th>Username</th><th>Email</th><th>Contact</th><th>Registered</th><th>Actions</th></tr></thead>
        <tbody>
          ${pending.map(u => `
            <tr id="pending-row-${u.id}">
              <td><strong>${u.username}</strong></td>
              <td>${u.email}</td>
              <td>${u.contact || '—'}</td>
              <td class="date-cell">${formatDate(u.created_at)}</td>
              <td style="display:flex;gap:8px">
                <button class="btn btn-small btn-primary" onclick="approveUser('${u.id}')">Approve</button>
                <button class="btn btn-small admin-delete-btn" onclick="denyUser('${u.id}')">Deny</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch {
    // non-critical — fail silently
  }
}

async function approveUser(id) {
  try {
    const res = await fetch(`/api/admin/users/${id}/approve`, { method: 'POST', credentials: 'include' });
    if (res.ok) {
      document.getElementById(`pending-row-${id}`)?.remove();
      loadPendingApprovals();
      loadAdminCustomers();
    } else {
      const d = await res.json();
      alert(d.error || 'Could not approve user.');
    }
  } catch { alert('Cannot connect to server.'); }
}

async function denyUser(id) {
  if (!confirm('Deny this registration? The user will be blocked from logging in.')) return;
  try {
    const res = await fetch(`/api/admin/users/${id}/deny`, { method: 'POST', credentials: 'include' });
    if (res.ok) {
      document.getElementById(`pending-row-${id}`)?.remove();
      loadPendingApprovals();
    } else {
      const d = await res.json();
      alert(d.error || 'Could not deny user.');
    }
  } catch { alert('Cannot connect to server.'); }
}

async function loadAdminCustomers() {
  const wrap  = document.getElementById('customers-list-wrap');
  const badge = document.getElementById('customer-count-badge');
  closeCustomerDetail();

  // Load pending approvals
  loadPendingApprovals();

  try {
    const res = await fetch('/api/admin/customers', { credentials: 'include' });
    _customers = await res.json();

    badge.textContent   = _customers.length;
    badge.style.display = _customers.length ? '' : 'none';

    if (!_customers.length) { wrap.innerHTML = '<p class="admin-empty">No customers yet.</p>'; return; }

    wrap.innerHTML = `<div class="admin-table-scroll">
      <table class="admin-table customers-table">
        <thead><tr>
          <th>#</th><th>Username</th><th>Email</th><th>Contact</th>
          <th>⭐ Points</th><th>Referred</th><th>Joined</th><th></th>
        </tr></thead>
        <tbody>
          ${_customers.map((c, i) => `
            <tr>
              <td style="color:var(--text-light)">${i+1}</td>
              <td><strong>${c.username}</strong>${c.isAdmin ? '<span class="admin-badge">Admin</span>' : ''}</td>
              <td>${c.email}</td>
              <td>${c.contact || '—'}</td>
              <td><span class="points-badge-admin">${c.points || 0} pts</span></td>
              <td>${c.referralCount} friend${c.referralCount !== 1 ? 's' : ''}</td>
              <td class="date-cell">${formatDate(c.createdAt)}</td>
              <td>
                <button class="btn btn-small admin-edit-btn"
                  onclick="showCustomerDetail('${c.id}')">View</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch {
    wrap.innerHTML = '<p class="admin-empty">Could not load customers.</p>';
  }
}

function showCustomerDetail(id) {
  const customer = _customers.find(c => c.id === id);
  if (!customer) return;
  document.getElementById('detail-username').textContent = `@${customer.username}`;
  const pointsBadgeId = `points-badge-${customer.id}`;
  const pointsInputId = `points-input-${customer.id}`;

  const ordersHTML = customer.orders && customer.orders.length
    ? `<div class="detail-orders">${customer.orders.map(o => `
        <div class="detail-order-row">
          <span class="date-cell">${formatDate(o.createdAt)}</span>
          <span>${o.items.map(i => `${i.name} ×${i.qty}`).join(', ')}</span>
          <strong>₱${parseFloat(o.total).toFixed(2)}</strong>
          <span class="status-select status-${o.status}" style="padding:3px 10px;border-radius:20px;font-size:0.78rem">${o.status}</span>
        </div>`).join('')}
      </div>`
    : '<p style="color:var(--text-light);font-size:0.88rem;padding:12px 20px">No orders found for this account.</p>';

  const avatarHTML = customer.avatarUrl
    ? `<img src="${customer.avatarUrl}" alt="Avatar" onclick="openImageModal(this.src)" style="width:72px;height:72px;border-radius:50%;object-fit:cover;display:block;cursor:zoom-in" />`
    : `<div style="width:72px;height:72px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:700">${(customer.username||'?')[0].toUpperCase()}</div>`;

  document.getElementById('customer-detail-body').innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;padding:20px;border-bottom:1px solid var(--border)">
      ${avatarHTML}
      <div>
        <div style="font-weight:700;font-size:1.05rem">@${customer.username}</div>
        <div style="color:var(--text-light);font-size:0.88rem">${customer.email}</div>
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-item"><span class="detail-label">Username</span><span class="detail-value">@${customer.username}</span></div>
      <div class="detail-item"><span class="detail-label">Email</span><span class="detail-value">${customer.email}</span></div>
      <div class="detail-item"><span class="detail-label">Contact</span><span class="detail-value">${customer.contact || '—'}</span></div>
      <div class="detail-item"><span class="detail-label">Referral Code</span><span class="detail-value code-style">${customer.referralCode}</span></div>
      <div class="detail-item"><span class="detail-label">Friends Referred</span><span class="detail-value">${customer.referralCount}</span></div>
      <div class="detail-item"><span class="detail-label">Referred By</span><span class="detail-value">${customer.referredBy || 'Direct sign-up'}</span></div>
      <div class="detail-item"><span class="detail-label">Member Since</span><span class="detail-value">${formatDate(customer.createdAt)}</span></div>
    </div>

    <div class="detail-section-title">⭐ Points Balance</div>
    <div style="padding:14px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--border)">
      <span class="points-badge-admin" id="${pointsBadgeId}">${customer.points || 0} pts</span>
      <div style="display:flex;gap:8px;align-items:center;flex:1;min-width:220px">
        <input type="number" id="${pointsInputId}" placeholder="+50 or -20"
          style="padding:8px 12px;border:1.5px solid var(--border);border-radius:6px;font-size:0.9rem;width:140px;outline:none" />
        <button class="btn btn-small admin-edit-btn"
          onclick="adjustPoints('${customer.id}','${pointsInputId}','${pointsBadgeId}')">Apply</button>
      </div>
      <small style="color:var(--text-light);font-size:0.78rem">Positive to add, negative to deduct.</small>
    </div>

    <div class="detail-section-title">Orders (${customer.orders ? customer.orders.length : 0})</div>
    ${ordersHTML}

    ${!customer.isAdmin ? `
      <div style="margin-top:20px;padding:0 20px 20px">
        <button class="btn btn-small admin-delete-btn" style="width:100%"
          onclick="deleteCustomer('${customer.id}','${customer.username.replace(/'/g,"\\'")}')">
          🗑️ Delete This Account
        </button>
      </div>` : ''}
  `;

  const detail = document.getElementById('customer-detail');
  detail.style.display = '';
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeCustomerDetail() {
  const el = document.getElementById('customer-detail');
  if (el) el.style.display = 'none';
}

async function adjustPoints(userId, inputId, badgeId) {
  const delta = parseInt(document.getElementById(inputId).value);
  if (isNaN(delta) || delta === 0) { alert('Enter a non-zero number.'); return; }
  try {
    const res  = await fetch(`/api/admin/users/${userId}/points`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: delta })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById(badgeId).textContent = data.points + ' pts';
      document.getElementById(inputId).value = '';
      alert(`✅ Points updated! New balance: ${data.points} pts`);
    } else alert(data.error || 'Could not update points.');
  } catch { alert('Cannot connect to server.'); }
}

async function deleteCustomer(id, username) {
  if (!confirm(`Delete account for "${username}"? Cannot be undone.`)) return;
  const res = await fetch(`/api/admin/customers/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) { closeCustomerDetail(); loadAdminCustomers(); }
  else { const d = await res.json(); alert(d.error || 'Could not delete.'); }
}


// ════════════════════════════════════════════════════════════
// DISCOUNTS
// ════════════════════════════════════════════════════════════

async function loadAdminDiscounts() {
  const wrap = document.getElementById('discounts-table-wrap');
  if (!wrap) return;
  try {
    const res       = await fetch('/api/discounts', { credentials: 'include' });
    const discounts = await res.json();
    if (!discounts.length) { wrap.innerHTML = '<p class="admin-empty">No discounts yet.</p>'; return; }
    wrap.innerHTML = `<div class="admin-table-scroll">
      <table class="admin-table">
        <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Actions</th></tr></thead>
        <tbody>
          ${discounts.map(d => `
            <tr>
              <td><strong class="code-style">${d.name}</strong></td>
              <td>${d.type === 'percent' ? '% Percent off' : '₱ Fixed amount'}</td>
              <td>${d.type === 'percent' ? d.value + '%' : '₱' + parseFloat(d.value).toFixed(2)}</td>
              <td class="admin-actions-cell">
                <button class="btn btn-small admin-edit-btn" onclick="openEditDiscountModal('${d.id}')">✏️ Edit</button>
                <button class="btn btn-small admin-delete-btn" onclick="deleteDiscount('${d.id}','${d.name}')">🗑️ Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch { wrap.innerHTML = '<p class="admin-empty">Could not load discounts.</p>'; }
}

function openDiscountModal() {
  document.getElementById('discount-modal-title').textContent = 'Add Discount';
  ['discount-id','discount-name','discount-value'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('discount-type').value  = 'percent';
  document.getElementById('discount-form-error').style.display = 'none';
  document.getElementById('discount-save-btn').textContent = 'Save Discount';
  document.getElementById('discount-modal').classList.add('open');
  document.getElementById('discount-modal-overlay').classList.add('open');
}

async function openEditDiscountModal(id) {
  const res = await fetch('/api/discounts', { credentials: 'include' });
  const d   = (await res.json()).find(x => x.id === id);
  if (!d) return;
  document.getElementById('discount-modal-title').textContent = 'Edit Discount';
  document.getElementById('discount-id').value    = d.id;
  document.getElementById('discount-name').value  = d.name;
  document.getElementById('discount-type').value  = d.type;
  document.getElementById('discount-value').value = d.value;
  document.getElementById('discount-form-error').style.display = 'none';
  document.getElementById('discount-save-btn').textContent = 'Update Discount';
  document.getElementById('discount-modal').classList.add('open');
  document.getElementById('discount-modal-overlay').classList.add('open');
}

function closeDiscountModal() {
  document.getElementById('discount-modal').classList.remove('open');
  document.getElementById('discount-modal-overlay').classList.remove('open');
}

async function saveDiscount(event) {
  event.preventDefault();
  const id       = document.getElementById('discount-id').value;
  const name     = document.getElementById('discount-name').value.trim();
  const type     = document.getElementById('discount-type').value;
  const value    = document.getElementById('discount-value').value;
  const errorBox = document.getElementById('discount-form-error');
  const saveBtn  = document.getElementById('discount-save-btn');
  errorBox.style.display = 'none'; saveBtn.disabled = true; saveBtn.textContent = 'Saving...';

  const isEditing = !!id;
  try {
    const res  = await fetch(isEditing ? `/api/admin/discounts/${id}` : '/api/admin/discounts', {
      method: isEditing ? 'PUT' : 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, value })
    });
    const data = await res.json();
    if (!res.ok) {
      errorBox.textContent   = data.error || 'Error.';
      errorBox.style.display = '';
      saveBtn.disabled = false; saveBtn.textContent = isEditing ? 'Update Discount' : 'Save Discount';
      return;
    }
    closeDiscountModal(); loadAdminDiscounts();
  } catch {
    errorBox.textContent = 'Cannot connect.'; errorBox.style.display = '';
    saveBtn.disabled = false; saveBtn.textContent = isEditing ? 'Update Discount' : 'Save Discount';
  }
}

async function deleteDiscount(id, name) {
  if (!confirm(`Delete discount "${name}"?`)) return;
  const res = await fetch(`/api/admin/discounts/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) loadAdminDiscounts();
  else alert('Could not delete discount.');
}


// ════════════════════════════════════════════════════════════
// FINANCE — SUB-TAB SWITCHING
// ════════════════════════════════════════════════════════════

let _currentFinTab = 'overview';

function switchFinTab(tab) {
  _currentFinTab = tab;
  const finTabs = ['overview','receivables','payables','expenses','purchases','reports','ledger'];
  finTabs.forEach(t => {
    document.getElementById(`fin-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`fin-panel-${t}`).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'overview')     loadFinanceOverview();
  if (tab === 'receivables')  loadFinanceReceivables();
  if (tab === 'payables')     loadFinancePayables();
  if (tab === 'expenses')     loadFinanceExpenses();
  if (tab === 'purchases')    loadFinancePurchases();
  if (tab === 'reports')      loadCurrentReport();
  if (tab === 'ledger')       loadFinanceLedger();
}


// ════════════════════════════════════════════════════════════
// FINANCE — OVERVIEW
// ════════════════════════════════════════════════════════════

// Active Chart.js instances — destroyed before each re-render
let _finActiveCharts = {};

async function loadFinanceOverview(period) {
  const el        = document.getElementById('fin-overview-content');
  const periodSel = document.getElementById('fin-period-select');
  const p         = period || (periodSel ? periodSel.value : 'allTime');

  el.innerHTML = `<div class="fin-loading"><div class="fin-spinner"></div><p>Loading dashboard…</p></div>`;

  try {
    const [overviewRes, ordersRes, expensesRes, receivablesRes] = await Promise.all([
      fetch(`/api/admin/finance/overview?period=${p}`, { credentials: 'include' }),
      fetch('/api/admin/orders',                        { credentials: 'include' }),
      fetch('/api/admin/expenses',                      { credentials: 'include' }),
      fetch('/api/admin/receivables',                   { credentials: 'include' })
    ]);

    if (!overviewRes.ok) {
      const errText = await overviewRes.text();
      console.error('[finance overview] API error', overviewRes.status, errText);
      el.innerHTML = `<p class="admin-empty" style="color:red">Finance API error (${overviewRes.status}): ${errText.slice(0,200)}</p>`;
      return;
    }

    const d           = await overviewRes.json();
    const orders      = ordersRes.ok      ? await ordersRes.json()      : [];
    const expenses    = expensesRes.ok    ? await expensesRes.json()    : [];
    const receivables = receivablesRes.ok ? await receivablesRes.json() : [];

    if (d.error) {
      console.error('[finance overview] response error:', d.error);
      el.innerHTML = `<p class="admin-empty" style="color:red">Finance error: ${d.error}</p>`;
      return;
    }

    const monthly  = _finCalcMonthly(orders, expenses);
    const insights = _finCalcInsights(d);
    const recent   = _finBuildActivity(orders, expenses, receivables);

    // sign helper — returns prefix string and whether positive
    const sig = v => ({ pfx: v >= 0 ? '₱' : '−₱', abs: Math.abs(v), pos: v >= 0 });
    const op = sig(d.operatingProfit);
    const cp = sig(d.estCashPosition);

    el.innerHTML = `
    <div class="fin-dash">

      <!-- ── 5 Big KPI Cards ──────────────────────── -->
      <div class="fin-kpi-main-grid">
        ${_finBigCard('Total Revenue',      d.totalRevenue,      d.paidOrders + ' confirmed orders',       '₱',     null)}
        ${_finBigCard('Net Profit',         d.operatingProfit,   'Gross Profit − Expenses',                op.pfx,  op.pos)}
        ${_finBigCard('Est. Cash Position', d.estCashPosition,   'Net Profit − Outstanding Payables',      cp.pfx,  cp.pos)}
        ${_finBigCard('Cost of Goods',      d.cogs,              'Item cost × qty for confirmed orders',   '₱',     null)}
        ${_finBigCard('Total Expenses',     d.totalExpenses,     'All recorded business expenses',         '₱',     null)}
      </div>

      <!-- ── Charts ───────────────────────────────── -->
      <div class="fin-charts-row">
        <div class="fin-chart-card">
          <div class="fin-chart-header">
            <h3>Revenue vs Expenses</h3>
            <span class="fin-chart-badge">Last 6 months</span>
          </div>
          <div class="fin-chart-wrap">
            <canvas id="fin-rev-exp-chart"></canvas>
          </div>
        </div>
        <div class="fin-chart-card">
          <div class="fin-chart-header">
            <h3>Profit Breakdown</h3>
            <span class="fin-chart-badge">Current period</span>
          </div>
          <div class="fin-chart-wrap">
            <canvas id="fin-profit-chart"></canvas>
          </div>
        </div>
      </div>

      <!-- ── Secondary Stats ──────────────────────── -->
      <div class="fin-secondary-grid">
        ${_finSmallCard('⏳', 'Pending Revenue',         d.pendingRevenue,         d.pendingOrders + ' orders awaiting',  'warn')}
        ${_finSmallCard('🧾', 'Outstanding Receivables', d.outstandingReceivables, 'Owed to you',                         d.outstandingReceivables > 0 ? 'warn' : 'ok')}
        ${_finSmallCard('📤', 'Outstanding Payables',    d.outstandingPayables,    'You owe this amount',                 d.outstandingPayables > 0 ? 'danger' : 'ok')}
        ${_finSmallCard('📦', 'Inventory Value',         d.inventoryValue,         d.totalProducts + ' products tracked', 'accent')}
      </div>

      <!-- ── Insights + Recent Activity ──────────── -->
      <div class="fin-bottom-row">
        <div class="fin-insights-card">
          <h3>💡 Insights</h3>
          <ul class="fin-insights-list">
            ${insights.map(i => `
              <li class="fin-insight fin-insight-${i.type}">
                <span class="fin-insight-dot"></span>
                <span>${i.text}</span>
              </li>`).join('')}
          </ul>
        </div>
        <div class="fin-activity-card">
          <h3>Recent Activity</h3>
          ${recent.length ? `
          <div class="fin-activity-wrap">
            <table class="fin-activity-table">
              <thead><tr>
                <th>Date</th><th>Type</th><th>Description</th><th>Amount</th><th>Status</th>
              </tr></thead>
              <tbody>
                ${recent.map(a => `
                  <tr>
                    <td>${new Date(a.date).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' })}</td>
                    <td><span class="fin-type-badge fin-type-${a.type}">${a.type}</span></td>
                    <td>${a.description}</td>
                    <td class="fin-amt">₱${fmt(a.amount)}</td>
                    <td><span class="fin-status-badge status-${a.badge}">${a.badge}</span></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>` : '<p class="admin-empty" style="padding:20px 0">No activity yet.</p>'}
        </div>
      </div>

      <!-- ── Formula Reference ─────────────────── -->
      <div class="fin-formula-bar">
        <strong>Formulas:</strong>&nbsp;
        Gross Profit = Revenue − COGS &nbsp;·&nbsp;
        Net Profit = Gross Profit − Expenses &nbsp;·&nbsp;
        Est. Cash Position = Net Profit − Outstanding Payables
      </div>

    </div>`;

    requestAnimationFrame(() => {
      _finRenderCharts(d, monthly);
      _finAnimateCounters(el);
    });

  } catch (err) {
    console.error('[finance overview] exception:', err);
    el.innerHTML = `<p class="admin-empty" style="color:red">Could not load overview: ${err.message}</p>`;
  }
}

// ── Combined recent activity builder ─────────────────────
function _finBuildActivity(orders, expenses, receivables) {
  const entries = [];

  orders.forEach(o => entries.push({
    date:        o.createdAt,
    type:        'order',
    description: o.customerName || 'Guest',
    amount:      o.total,
    badge:       o.status
  }));

  expenses.forEach(e => entries.push({
    date:        e.createdAt || e.date,
    type:        'expense',
    description: e.category + (e.description ? ' — ' + e.description : ''),
    amount:      e.amount,
    badge:       'expense'
  }));

  receivables.forEach(r => entries.push({
    date:        r.createdAt,
    type:        'receivable',
    description: r.customerName + (r.notes ? ' — ' + r.notes : ''),
    amount:      r.amount,
    badge:       r.status
  }));

  entries.sort((a, b) => new Date(b.date) - new Date(a.date));
  return entries.slice(0, 10);
}

// ── Big KPI card builder ──────────────────────────────────
function _finBigCard(label, rawValue, sub, prefix, isPositive) {
  const abs      = Math.abs(rawValue);
  const posClass = isPositive === null ? '' : (isPositive ? 'fin-pos' : 'fin-neg');
  const arrow    = isPositive === null ? ''
    : `<span class="fin-trend-arrow ${isPositive ? 'fin-pos' : 'fin-neg'}">${isPositive ? '↑' : '↓'}</span>`;
  return `
    <div class="fin-kpi-main-card ${posClass}" data-target="${abs}">
      <div class="fin-kpi-top">${arrow}</div>
      <p class="fin-kpi-label">${label}</p>
      <p class="fin-kpi-value">${prefix}<span class="fin-counter">${fmt(abs)}</span></p>
      <p class="fin-kpi-sub">${sub}</p>
    </div>`;
}

// ── Secondary (small) card builder ───────────────────────
function _finSmallCard(icon, label, value, sub, type) {
  return `
    <div class="fin-sec-card fin-sec-${type}">
      <div class="fin-sec-top">
        <span class="fin-sec-icon">${icon}</span>
        <span class="fin-sec-label">${label}</span>
      </div>
      <p class="fin-sec-value">₱${fmt(value)}</p>
      <p class="fin-sec-sub">${sub}</p>
    </div>`;
}

// ── Insights generator ────────────────────────────────────
function _finCalcInsights(d) {
  const ins    = [];
  const margin = d.totalRevenue > 0 ? (d.operatingProfit / d.totalRevenue * 100) : null;

  if (margin !== null) {
    if (margin >= 30)
      ins.push({ text: `Strong profit margin at ${margin.toFixed(1)}% — business is healthy.`, type: 'good' });
    else if (margin >= 10)
      ins.push({ text: `Moderate profit margin at ${margin.toFixed(1)}% — consider reducing costs.`, type: 'warn' });
    else
      ins.push({ text: `Low profit margin at ${margin.toFixed(1)}% — review COGS and expenses urgently.`, type: 'bad' });
  }

  if (d.estCashPosition > 0)
    ins.push({ text: `Positive cash position of ₱${fmt(d.estCashPosition)} — solid financial health.`, type: 'good' });
  else if (d.estCashPosition < 0)
    ins.push({ text: `Negative cash position — outstanding payables exceed net profit.`, type: 'bad' });

  if (d.outstandingReceivables === 0 && d.totalRevenue > 0)
    ins.push({ text: 'No outstanding receivables — excellent cash collection.', type: 'good' });
  else if (d.outstandingReceivables > 0)
    ins.push({ text: `₱${fmt(d.outstandingReceivables)} in receivables pending follow-up.`, type: 'warn' });

  if (d.pendingOrders > 0)
    ins.push({ text: `${d.pendingOrders} pending order${d.pendingOrders > 1 ? 's' : ''} — ₱${fmt(d.pendingRevenue)} potential revenue.`, type: 'info' });

  if (!ins.length)
    ins.push({ text: 'No data yet — start recording orders and expenses.', type: 'info' });

  return ins;
}

// ── Monthly chart data ────────────────────────────────────
function _finCalcMonthly(orders, expenses) {
  const PAID   = ['confirmed', 'shipped', 'delivered'];
  const now    = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const rev = Object.fromEntries(months.map(m => [m, 0]));
  const exp = Object.fromEntries(months.map(m => [m, 0]));

  orders.forEach(o => {
    if (PAID.includes(o.status) && o.createdAt) {
      const m = String(o.createdAt).slice(0, 7);
      if (m in rev) rev[m] += o.total || 0;
    }
  });

  expenses.forEach(e => {
    if (e.date) {
      const m = String(e.date).slice(0, 7);
      if (m in exp) exp[m] += e.amount || 0;
    }
  });

  const labels = months.map(m => {
    const [yr, mo] = m.split('-');
    return new Date(yr, parseInt(mo) - 1).toLocaleDateString('en-PH', { month: 'short', year: '2-digit' });
  });

  return { labels, revenue: months.map(m => rev[m]), expenses: months.map(m => exp[m]) };
}

// ── Chart.js rendering ────────────────────────────────────
function _finRenderCharts(d, monthly) {
  if (typeof Chart === 'undefined') {
    setTimeout(() => _finRenderCharts(d, monthly), 150);
    return;
  }
  Object.values(_finActiveCharts).forEach(c => c && c.destroy && c.destroy());
  _finActiveCharts = {};

  // Line chart — Revenue vs Expenses
  const c1 = document.getElementById('fin-rev-exp-chart');
  if (c1) {
    _finActiveCharts.line = new Chart(c1, {
      type: 'line',
      data: {
        labels: monthly.labels,
        datasets: [
          {
            label: 'Revenue',
            data: monthly.revenue,
            borderColor: '#16a34a',
            backgroundColor: 'rgba(22,163,74,0.08)',
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: '#16a34a',
            tension: 0.4,
            fill: true
          },
          {
            label: 'Expenses',
            data: monthly.expenses,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.06)',
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: '#ef4444',
            tension: 0.4,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 12 }, usePointStyle: true, padding: 16 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ₱${fmt(ctx.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              font: { size: 11 },
              callback: v => '₱' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)
            }
          }
        }
      }
    });
  }

  // Doughnut chart — Profit Breakdown
  const c2 = document.getElementById('fin-profit-chart');
  if (c2) {
    const profit = Math.max(0, d.operatingProfit);
    _finActiveCharts.donut = new Chart(c2, {
      type: 'doughnut',
      data: {
        labels: ['Revenue', 'COGS', 'Expenses', 'Net Profit'],
        datasets: [{
          data: [d.totalRevenue, d.cogs, d.totalExpenses, profit],
          backgroundColor: ['#3a8a3a', '#f59e0b', '#ef4444', '#16a34a'],
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'right', labels: { font: { size: 11 }, usePointStyle: true, padding: 12 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ₱${fmt(ctx.parsed)}` } }
        }
      }
    });
  }
}

// ── Animated number counters ──────────────────────────────
function _finAnimateCounters(container) {
  container.querySelectorAll('[data-target]').forEach(card => {
    const target  = parseFloat(card.dataset.target) || 0;
    const counter = card.querySelector('.fin-counter');
    if (!counter || !target) return;
    const duration = 900;
    const start    = performance.now();
    const tick     = (now) => {
      const t     = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      counter.textContent = fmt(target * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ── Dark mode toggle ──────────────────────────────────────
function toggleFinDark() {
  const btn  = document.getElementById('fin-dark-btn');
  const wrap = document.getElementById('fin-overview-content');
  const dark = wrap.classList.toggle('fin-dark');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
  // Re-render charts with updated colors
  const dash = wrap.querySelector('.fin-dash');
  if (dash && _finActiveCharts.line) {
    _finActiveCharts.line.options.scales.y.grid.color = dark
      ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
    _finActiveCharts.line.update();
  }
}

// kpiCard kept for any legacy usage in other panels
function kpiCard(label, value, sub, extraClass = '') {
  return `
    <div class="fin-kpi-card ${extraClass}">
      <p class="fin-kpi-label">${label}</p>
      <p class="fin-kpi-value">${value}</p>
      <p class="fin-kpi-sub">${sub}</p>
    </div>`;
}



function openInventoryModal(id, name, stock, cost, category) {
  document.getElementById('inventory-modal-title').textContent = `Update Inventory — ${name}`;
  document.getElementById('inventory-product-id').value = id;
  document.getElementById('inv-stock').value    = stock;
  document.getElementById('inv-cost').value     = cost;
  document.getElementById('inv-category').value = category;
  document.getElementById('inventory-form-error').style.display = 'none';
  document.getElementById('inventory-modal').classList.add('open');
  document.getElementById('inventory-modal-overlay').classList.add('open');
}

function closeInventoryModal() {
  document.getElementById('inventory-modal').classList.remove('open');
  document.getElementById('inventory-modal-overlay').classList.remove('open');
}

async function saveInventory(event) {
  event.preventDefault();
  const id       = document.getElementById('inventory-product-id').value;
  const errorBox = document.getElementById('inventory-form-error');
  errorBox.style.display = 'none';

  try {
    const res = await fetch(`/api/admin/products/${id}/inventory`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stockQuantity: document.getElementById('inv-stock').value,
        costPrice:     document.getElementById('inv-cost').value,
        category:      document.getElementById('inv-category').value
      })
    });
    if (!res.ok) {
      const d = await res.json();
      errorBox.textContent = d.error || 'Error saving.';
      errorBox.style.display = '';
      return;
    }
    closeInventoryModal();
    loadInventory();
  } catch {
    errorBox.textContent = 'Cannot connect.';
    errorBox.style.display = '';
  }
}



// Update margin badge as user types (before saving)
function updatePriceInline(productId, input, type) {
  const row   = input.closest('tr');
  const cost  = parseFloat(row.querySelector('.price-cost-input').value) || 0;
  const sell  = parseFloat(row.querySelector('.price-sell-input').value) || 0;
  const badge = document.getElementById(`margin-${productId}`);
  if (badge && sell > 0 && cost > 0) {
    const margin = ((sell - cost) / sell * 100).toFixed(1);
    badge.textContent = margin + '%';
    badge.style.color = parseFloat(margin) < 20 ? '#dc3545' : parseFloat(margin) < 40 ? '#ffc107' : '#28a745';
  } else if (badge) {
    badge.textContent = '—';
  }
}

async function savePriceRow(productId) {
  const row     = document.querySelector(`.price-cost-input[data-id="${productId}"]`).closest('tr');
  const cost    = parseFloat(row.querySelector('.price-cost-input').value) || 0;
  const sell    = parseFloat(row.querySelector('.price-sell-input').value) || 0;

  // Update inventory (cost) + product price (sell) in parallel
  const [invRes, priceRes] = await Promise.all([
    fetch(`/api/admin/products/${productId}/inventory`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ costPrice: cost })
    }),
    fetch(`/api/admin/products/${productId}`, {
      method: 'PUT', credentials: 'include',
      body: (() => { const fd = new FormData(); fd.append('price', sell); return fd; })()
    })
  ]);

  if (invRes.ok && priceRes.ok) {
    const badge = document.getElementById(`margin-${productId}`);
    if (badge) {
      const margin = sell > 0 && cost > 0 ? ((sell - cost) / sell * 100).toFixed(1) : '—';
      badge.textContent = margin !== '—' ? margin + '%' : '—';
    }
    showToast('Price updated!');
  } else {
    alert('Could not save price. Please try again.');
  }
}


// ════════════════════════════════════════════════════════════
// FINANCE — RECEIVABLES
// ════════════════════════════════════════════════════════════

let _allReceivables = [];

async function loadFinanceReceivables() {
  const el = document.getElementById('fin-receivables-content');
  try {
    const res  = await fetch('/api/admin/receivables', { credentials: 'include' });
    _allReceivables = await res.json();
    renderReceivables(_allReceivables);
  } catch {
    el.innerHTML = '<p class="admin-empty">Could not load receivables.</p>';
  }
}

function renderReceivables(items) {
  const el    = document.getElementById('fin-receivables-content');
  const total = items.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
  const pending = items.filter(r => r.status !== 'paid').reduce((s, r) => s + parseFloat(r.amount || 0), 0);

  if (!items.length) { el.innerHTML = '<p class="admin-empty">No receivables yet. Click "+ Add Receivable" to create one.</p>'; return; }

  el.innerHTML = `
    <div style="padding:12px 24px;background:var(--accent-light);border-bottom:1px solid var(--border);display:flex;gap:24px;flex-wrap:wrap">
      <span>Total: <strong>₱${fmt(total)}</strong></span>
      <span>Pending: <strong style="color:#856404">₱${fmt(pending)}</strong></span>
      <span>Paid: <strong style="color:#28a745">₱${fmt(total - pending)}</strong></span>
    </div>
    <div class="admin-table-scroll"><table class="admin-table">
      <thead><tr>
        <th>Customer</th><th>Amount</th><th>Status</th><th>Due Date</th>
        <th>Order ID</th><th>Notes</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${items.map(r => `
          <tr>
            <td><strong>${r.customerName}</strong></td>
            <td class="admin-price-cell">₱${fmt(r.amount)}</td>
            <td><span class="fin-status-badge fin-status-${r.status}">${r.status}</span></td>
            <td class="date-cell">${r.dueDate || '—'}</td>
            <td style="font-size:0.8rem;color:var(--text-light)">${r.relatedOrderId || '—'}</td>
            <td style="font-size:0.82rem;color:var(--text-light);max-width:140px">${r.notes || '—'}</td>
            <td class="admin-actions-cell">
              <button class="btn btn-small admin-edit-btn" onclick='openEditReceivableModal(${JSON.stringify(r)})'>✏️ Edit</button>
              <button class="btn btn-small admin-delete-btn" onclick="deleteReceivable('${r.id}')">🗑️</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function openReceivableModal() {
  document.getElementById('receivable-modal-title').textContent = 'Add Receivable';
  ['receivable-id','rec-customer','rec-amount','rec-due','rec-order','rec-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('rec-status').value = 'pending';
  document.getElementById('receivable-form-error').style.display = 'none';
  document.getElementById('receivable-save-btn').textContent = 'Save';
  document.getElementById('receivable-modal').classList.add('open');
  document.getElementById('receivable-modal-overlay').classList.add('open');
}

function openEditReceivableModal(rec) {
  document.getElementById('receivable-modal-title').textContent = 'Edit Receivable';
  document.getElementById('receivable-id').value  = rec.id;
  document.getElementById('rec-customer').value   = rec.customerName;
  document.getElementById('rec-amount').value     = rec.amount;
  document.getElementById('rec-status').value     = rec.status;
  document.getElementById('rec-due').value        = rec.dueDate || '';
  document.getElementById('rec-order').value      = rec.relatedOrderId || '';
  document.getElementById('rec-notes').value      = rec.notes || '';
  document.getElementById('receivable-form-error').style.display = 'none';
  document.getElementById('receivable-save-btn').textContent = 'Update';
  document.getElementById('receivable-modal').classList.add('open');
  document.getElementById('receivable-modal-overlay').classList.add('open');
}

function closeReceivableModal() {
  document.getElementById('receivable-modal').classList.remove('open');
  document.getElementById('receivable-modal-overlay').classList.remove('open');
}

async function saveReceivable(event) {
  event.preventDefault();
  const id       = document.getElementById('receivable-id').value;
  const errorBox = document.getElementById('receivable-form-error');
  const saveBtn  = document.getElementById('receivable-save-btn');
  errorBox.style.display = 'none'; saveBtn.disabled = true; saveBtn.textContent = 'Saving...';

  const body = {
    customerName:   document.getElementById('rec-customer').value.trim(),
    amount:         document.getElementById('rec-amount').value,
    status:         document.getElementById('rec-status').value,
    dueDate:        document.getElementById('rec-due').value,
    relatedOrderId: document.getElementById('rec-order').value.trim(),
    notes:          document.getElementById('rec-notes').value.trim()
  };

  try {
    const res = await fetch(id ? `/api/admin/receivables/${id}` : '/api/admin/receivables', {
      method: id ? 'PUT' : 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      errorBox.textContent = data.error || 'Error.'; errorBox.style.display = '';
      saveBtn.disabled = false; saveBtn.textContent = id ? 'Update' : 'Save'; return;
    }
    closeReceivableModal(); loadFinanceReceivables();
  } catch {
    errorBox.textContent = 'Cannot connect.'; errorBox.style.display = '';
    saveBtn.disabled = false; saveBtn.textContent = id ? 'Update' : 'Save';
  }
}

async function deleteReceivable(id) {
  if (!confirm('Delete this receivable?')) return;
  const res = await fetch(`/api/admin/receivables/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) loadFinanceReceivables();
  else alert('Could not delete.');
}

function applyReceivableFilter() {
  const status = document.getElementById('rec-filter-status')?.value || '';
  let filtered = _allReceivables;
  if (status) filtered = filtered.filter(r => r.status === status);
  renderReceivables(filtered);
}

function clearReceivableFilter() {
  const el = document.getElementById('rec-filter-status');
  if (el) el.value = '';
  renderReceivables(_allReceivables);
}

async function syncOrdersToReceivables() {
  try {
    const res  = await fetch('/api/admin/finance/sync-receivables', {
      method: 'POST', credentials: 'include'
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Synced ${data.synced} order(s) to receivables.`);
      loadFinanceReceivables();
    } else {
      alert(data.error || 'Sync failed.');
    }
  } catch {
    alert('Cannot connect to server.');
  }
}


// ════════════════════════════════════════════════════════════
// FINANCE — PAYABLES
// ════════════════════════════════════════════════════════════

let _allPayables = [];

async function loadFinancePayables() {
  const el = document.getElementById('fin-payables-content');
  try {
    const res  = await fetch('/api/admin/payables', { credentials: 'include' });
    _allPayables = await res.json();
    applyPayableFilter();
  } catch {
    el.innerHTML = '<p class="admin-empty">Could not load payables.</p>';
  }
}

function applyPayableFilter() {
  const status = document.getElementById('pay-filter-status')?.value || '';
  let filtered = _allPayables;
  if (status) filtered = filtered.filter(p => p.status === status);
  renderPayables(filtered);
}

function clearPayableFilter() {
  const el = document.getElementById('pay-filter-status');
  if (el) el.value = '';
  renderPayables(_allPayables);
}

function renderPayables(items) {
  const el      = document.getElementById('fin-payables-content');
  const total   = items.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const unpaid  = items.filter(p => p.status !== 'paid').reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  if (!items.length) { el.innerHTML = '<p class="admin-empty">No payables yet. Click "+ Add Payable" to create one.</p>'; return; }

  el.innerHTML = `
    <div style="padding:12px 24px;background:var(--accent-light);border-bottom:1px solid var(--border);display:flex;gap:24px;flex-wrap:wrap">
      <span>Total: <strong>₱${fmt(total)}</strong></span>
      <span>Unpaid: <strong style="color:#dc3545">₱${fmt(unpaid)}</strong></span>
      <span>Paid: <strong style="color:#28a745">₱${fmt(total - unpaid)}</strong></span>
    </div>
    <div class="admin-table-scroll"><table class="admin-table">
      <thead><tr>
        <th>Supplier</th><th>Description</th><th>Amount</th><th>Status</th>
        <th>Due Date</th><th>Notes</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${items.map(p => `
          <tr>
            <td><strong>${p.supplierName}</strong></td>
            <td style="font-size:0.85rem;color:var(--text-light)">${p.description || '—'}</td>
            <td class="admin-price-cell">₱${fmt(p.amount)}</td>
            <td><span class="fin-status-badge fin-status-${p.status}">${p.status}</span></td>
            <td class="date-cell">${p.dueDate || '—'}</td>
            <td style="font-size:0.82rem;color:var(--text-light);max-width:140px">${p.notes || '—'}</td>
            <td class="admin-actions-cell">
              <button class="btn btn-small admin-edit-btn" onclick='openEditPayableModal(${JSON.stringify(p)})'>✏️ Edit</button>
              <button class="btn btn-small admin-delete-btn" onclick="deletePayable('${p.id}')">🗑️</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function openPayableModal() {
  document.getElementById('payable-modal-title').textContent = 'Add Payable';
  ['payable-id','pay-supplier','pay-desc','pay-amount','pay-due','pay-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pay-status').value = 'unpaid';
  document.getElementById('payable-form-error').style.display = 'none';
  document.getElementById('payable-save-btn').textContent = 'Save';
  document.getElementById('payable-modal').classList.add('open');
  document.getElementById('payable-modal-overlay').classList.add('open');
}

function openEditPayableModal(p) {
  document.getElementById('payable-modal-title').textContent = 'Edit Payable';
  document.getElementById('payable-id').value     = p.id;
  document.getElementById('pay-supplier').value   = p.supplierName;
  document.getElementById('pay-desc').value       = p.description || '';
  document.getElementById('pay-amount').value     = p.amount;
  document.getElementById('pay-status').value     = p.status;
  document.getElementById('pay-due').value        = p.dueDate || '';
  document.getElementById('pay-notes').value      = p.notes || '';
  document.getElementById('payable-form-error').style.display = 'none';
  document.getElementById('payable-save-btn').textContent = 'Update';
  document.getElementById('payable-modal').classList.add('open');
  document.getElementById('payable-modal-overlay').classList.add('open');
}

function closePayableModal() {
  document.getElementById('payable-modal').classList.remove('open');
  document.getElementById('payable-modal-overlay').classList.remove('open');
}

async function savePayable(event) {
  event.preventDefault();
  const id       = document.getElementById('payable-id').value;
  const errorBox = document.getElementById('payable-form-error');
  const saveBtn  = document.getElementById('payable-save-btn');
  errorBox.style.display = 'none'; saveBtn.disabled = true; saveBtn.textContent = 'Saving...';

  const body = {
    supplierName: document.getElementById('pay-supplier').value.trim(),
    description:  document.getElementById('pay-desc').value.trim(),
    amount:       document.getElementById('pay-amount').value,
    status:       document.getElementById('pay-status').value,
    dueDate:      document.getElementById('pay-due').value,
    notes:        document.getElementById('pay-notes').value.trim()
  };

  try {
    const res = await fetch(id ? `/api/admin/payables/${id}` : '/api/admin/payables', {
      method: id ? 'PUT' : 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      errorBox.textContent = data.error || 'Error.'; errorBox.style.display = '';
      saveBtn.disabled = false; saveBtn.textContent = id ? 'Update' : 'Save'; return;
    }
    closePayableModal(); loadFinancePayables();
  } catch {
    errorBox.textContent = 'Cannot connect.'; errorBox.style.display = '';
    saveBtn.disabled = false; saveBtn.textContent = id ? 'Update' : 'Save';
  }
}

async function deletePayable(id) {
  if (!confirm('Delete this payable?')) return;
  const res = await fetch(`/api/admin/payables/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) loadFinancePayables();
  else alert('Could not delete.');
}


// ════════════════════════════════════════════════════════════
// FINANCE — EXPENSES
// ════════════════════════════════════════════════════════════

let _allExpenses = [];

async function loadFinanceExpenses() {
  const el = document.getElementById('fin-expenses-content');
  try {
    const res   = await fetch('/api/admin/expenses', { credentials: 'include' });
    _allExpenses = await res.json();
    applyExpenseFilter();
  } catch {
    el.innerHTML = '<p class="admin-empty">Could not load expenses.</p>';
  }
}

function applyExpenseFilter() {
  const cat    = document.getElementById('expense-filter-cat').value;
  const from   = document.getElementById('expense-filter-from').value;
  const to     = document.getElementById('expense-filter-to').value;

  let filtered = _allExpenses;
  if (cat)  filtered = filtered.filter(e => e.category === cat);
  if (from) filtered = filtered.filter(e => e.date >= from);
  if (to)   filtered = filtered.filter(e => e.date <= to);

  renderExpenses(filtered);
}

function clearExpenseFilter() {
  ['expense-filter-cat','expense-filter-from','expense-filter-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderExpenses(_allExpenses);
}

function renderExpenses(items) {
  const el    = document.getElementById('fin-expenses-content');
  const total = items.reduce((s, e) => s + parseFloat(e.amount || 0), 0);

  if (!items.length) { el.innerHTML = '<p class="admin-empty">No expenses found.</p>'; return; }

  // Group by category for summary
  const byCat = {};
  items.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + parseFloat(e.amount || 0); });

  el.innerHTML = `
    <div style="padding:12px 24px;background:var(--accent-light);border-bottom:1px solid var(--border);display:flex;gap:24px;flex-wrap:wrap;align-items:center">
      <span>Total: <strong>₱${fmt(total)}</strong></span>
      <span style="font-size:0.82rem;color:var(--text-light)">
        ${Object.entries(byCat).map(([cat,amt]) => `${cat}: ₱${fmt(amt)}`).join(' · ')}
      </span>
    </div>
    <div class="admin-table-scroll"><table class="admin-table">
      <thead><tr>
        <th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${items.map(e => `
          <tr>
            <td class="date-cell">${e.date}</td>
            <td><span class="expense-cat-badge">${e.category}</span></td>
            <td style="font-size:0.85rem">${e.description || '—'}</td>
            <td class="admin-price-cell">₱${fmt(e.amount)}</td>
            <td class="admin-actions-cell">
              <button class="btn btn-small admin-edit-btn" onclick='openEditExpenseModal(${JSON.stringify(e)})'>✏️ Edit</button>
              <button class="btn btn-small admin-delete-btn" onclick="deleteExpense('${e.id}')">🗑️</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function openExpenseModal() {
  document.getElementById('expense-modal-title').textContent = 'Add Expense';
  ['expense-id','exp-desc','exp-amount'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('exp-category').value  = '';
  document.getElementById('exp-date').value       = new Date().toISOString().slice(0, 10);
  document.getElementById('expense-form-error').style.display = 'none';
  document.getElementById('expense-save-btn').textContent = 'Save Expense';
  document.getElementById('expense-modal').classList.add('open');
  document.getElementById('expense-modal-overlay').classList.add('open');
}

function openEditExpenseModal(exp) {
  document.getElementById('expense-modal-title').textContent = 'Edit Expense';
  document.getElementById('expense-id').value    = exp.id;
  document.getElementById('exp-category').value  = exp.category;
  document.getElementById('exp-desc').value      = exp.description || '';
  document.getElementById('exp-amount').value    = exp.amount;
  document.getElementById('exp-date').value      = exp.date;
  document.getElementById('expense-form-error').style.display = 'none';
  document.getElementById('expense-save-btn').textContent = 'Update';
  document.getElementById('expense-modal').classList.add('open');
  document.getElementById('expense-modal-overlay').classList.add('open');
}

function closeExpenseModal() {
  document.getElementById('expense-modal').classList.remove('open');
  document.getElementById('expense-modal-overlay').classList.remove('open');
}

async function saveExpense(event) {
  event.preventDefault();
  const id       = document.getElementById('expense-id').value;
  const errorBox = document.getElementById('expense-form-error');
  const saveBtn  = document.getElementById('expense-save-btn');
  errorBox.style.display = 'none'; saveBtn.disabled = true; saveBtn.textContent = 'Saving...';

  const body = {
    category:    document.getElementById('exp-category').value,
    description: document.getElementById('exp-desc').value.trim(),
    amount:      document.getElementById('exp-amount').value,
    date:        document.getElementById('exp-date').value
  };

  try {
    const res = await fetch(id ? `/api/admin/expenses/${id}` : '/api/admin/expenses', {
      method: id ? 'PUT' : 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      errorBox.textContent = data.error || 'Error.'; errorBox.style.display = '';
      saveBtn.disabled = false; saveBtn.textContent = id ? 'Update' : 'Save Expense'; return;
    }
    closeExpenseModal(); loadFinanceExpenses();
  } catch {
    errorBox.textContent = 'Cannot connect.'; errorBox.style.display = '';
    saveBtn.disabled = false; saveBtn.textContent = id ? 'Update' : 'Save Expense';
  }
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  const res = await fetch(`/api/admin/expenses/${id}`, { method: 'DELETE', credentials: 'include' });
  if (res.ok) loadFinanceExpenses();
  else alert('Could not delete.');
}


// ════════════════════════════════════════════════════════════
// FINANCE — PURCHASES
// ════════════════════════════════════════════════════════════

let _allPurchases = [];

async function loadFinancePurchases() {
  const el = document.getElementById('fin-purchases-content');
  el.innerHTML = '<p class="admin-loading">Loading purchases...</p>';
  try {
    const res = await fetch('/api/admin/purchases', { credentials: 'include' });
    _allPurchases = await res.json();
    renderPurchases(_allPurchases);
  } catch {
    el.innerHTML = '<p class="admin-empty">Could not load purchases.</p>';
  }
}

function renderPurchases(items) {
  const el = document.getElementById('fin-purchases-content');
  if (!items.length) {
    el.innerHTML = '<p class="admin-empty">No purchases recorded yet.</p>';
    return;
  }
  const totalOwed = items.reduce((s, p) => s + (p.balanceDue || 0), 0);
  el.innerHTML = `
    <div style="padding:12px 24px;background:var(--accent-light);border-bottom:1px solid var(--border);display:flex;gap:24px;flex-wrap:wrap">
      <span>Total Purchases: <strong>${items.length}</strong></span>
      <span>Outstanding: <strong style="color:var(--danger)">₱${fmt(totalOwed)}</strong></span>
    </div>
    <div class="admin-table-scroll"><table class="admin-table">
      <thead><tr>
        <th>Date</th><th>Supplier</th><th>Ref</th>
        <th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${items.map(p => `
          <tr>
            <td>${p.date ? p.date.slice(0,10) : '—'}</td>
            <td><strong>${esc(p.supplierName)}</strong></td>
            <td style="color:var(--text-light);font-size:0.85rem">${esc(p.supplierRef || '—')}</td>
            <td>₱${fmt(p.total)}</td>
            <td>₱${fmt(p.amountPaid)}</td>
            <td style="color:${p.balanceDue > 0 ? 'var(--danger)' : 'var(--success)'}">₱${fmt(p.balanceDue)}</td>
            <td><span class="status-badge status-${p.paymentStatus}">${p.paymentStatus}</span></td>
            <td>
              ${p.balanceDue > 0 ? `<button class="btn btn-outline btn-small" onclick="openSupplierPaymentModal('${p.id}',${p.balanceDue})">Pay</button>` : ''}
              <button class="btn btn-outline btn-small" onclick="viewPurchaseItems(${JSON.stringify(p).replace(/"/g,'&quot;')})">Items</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function viewPurchaseItems(p) {
  const lines = (p.items || []).map(it => `
    <tr>
      <td>${esc(it.name || '—')}</td>
      <td>${it.qty}</td>
      <td>₱${fmt(it.unit_cost)}</td>
      <td>₱${fmt(it.line_total)}</td>
    </tr>`).join('');
  const html = `
    <div style="padding:16px 20px">
      <h3 style="margin:0 0 12px">${esc(p.supplierName)} — ${p.date ? p.date.slice(0,10) : ''}</h3>
      <table class="admin-table" style="margin-bottom:12px">
        <thead><tr><th>Item</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead>
        <tbody>${lines || '<tr><td colspan="4" style="text-align:center;color:var(--text-light)">No items</td></tr>'}</tbody>
      </table>
      <div style="text-align:right;font-weight:600">Total: ₱${fmt(p.total)}</div>
    </div>`;
  const overlay = document.getElementById('purchase-modal-overlay');
  const modal   = document.getElementById('purchase-modal');
  modal.querySelector('.modal-header h2').textContent = 'Purchase Details';
  modal.querySelector('.modal-scroll-body').innerHTML = html +
    `<div style="padding:0 20px 16px"><button class="btn btn-outline btn-full" onclick="closePurchaseModal()">Close</button></div>`;
  overlay.style.display = modal.style.display = '';
}

function openPurchaseModal() {
  document.getElementById('purchase-modal').querySelector('.modal-header h2').textContent = 'New Purchase';
  document.getElementById('purchase-form').reset();
  document.getElementById('purchase-items-list').innerHTML = '';
  document.getElementById('pur-total-display').textContent = '0.00';
  document.getElementById('pur-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('purchase-form-error').style.display = 'none';
  document.getElementById('purchase-save-btn').textContent = 'Record Purchase';
  addPurchaseItem();
  document.getElementById('purchase-modal-overlay').style.display = '';
  document.getElementById('purchase-modal').style.display = '';
}

function closePurchaseModal() {
  document.getElementById('purchase-modal-overlay').style.display = 'none';
  document.getElementById('purchase-modal').style.display = 'none';
}

function addPurchaseItem() {
  const list = document.getElementById('purchase-items-list');
  if (!list) return;
  const idx = list.children.length;
  const row = document.createElement('div');
  row.className = 'purchase-item-row';
  row.style.cssText = 'display:grid;grid-template-columns:2fr 80px 100px auto;gap:8px;align-items:center;margin-bottom:6px';
  row.innerHTML = `
    <input type="text"   placeholder="Item name / product" class="pur-item-name"  oninput="recalcPurchaseTotal()" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:0.88rem" />
    <input type="number" placeholder="Qty"  class="pur-item-qty"  min="1" step="1"    value="1"   oninput="recalcPurchaseTotal()" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:0.88rem" />
    <input type="number" placeholder="Cost" class="pur-item-cost" min="0" step="0.01" value="0"   oninput="recalcPurchaseTotal()" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:0.88rem" />
    <button type="button" onclick="this.closest('.purchase-item-row').remove();recalcPurchaseTotal()" style="background:none;border:none;color:var(--danger);font-size:1.1rem;cursor:pointer;padding:4px">✕</button>`;
  list.appendChild(row);
}

function recalcPurchaseTotal() {
  const rows  = document.querySelectorAll('.purchase-item-row');
  let total = 0;
  rows.forEach(r => {
    const qty  = parseFloat(r.querySelector('.pur-item-qty').value)  || 0;
    const cost = parseFloat(r.querySelector('.pur-item-cost').value) || 0;
    total += qty * cost;
  });
  const el = document.getElementById('pur-total-display');
  if (el) el.textContent = fmt(total);
}

async function savePurchase(e) {
  e.preventDefault();
  const errEl  = document.getElementById('purchase-form-error');
  const saveBtn = document.getElementById('purchase-save-btn');
  errEl.style.display = 'none';

  const rows = [...document.querySelectorAll('.purchase-item-row')];
  const items = rows.map(r => ({
    name:     r.querySelector('.pur-item-name').value.trim(),
    qty:      parseFloat(r.querySelector('.pur-item-qty').value)  || 0,
    unitCost: parseFloat(r.querySelector('.pur-item-cost').value) || 0
  })).filter(it => it.name && it.qty > 0);

  if (!items.length) {
    errEl.textContent = 'Add at least one item with a name and quantity.';
    errEl.style.display = '';
    return;
  }

  const body = {
    supplierName: document.getElementById('pur-supplier').value.trim(),
    supplierRef:  document.getElementById('pur-ref').value.trim(),
    date:         document.getElementById('pur-date').value,
    amountPaid:   parseFloat(document.getElementById('pur-amount-paid').value) || 0,
    method:       document.getElementById('pur-method').value,
    notes:        document.getElementById('pur-notes').value.trim(),
    items
  };

  saveBtn.disabled = true; saveBtn.textContent = 'Saving...';
  try {
    const res = await fetch('/api/admin/purchases', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Error saving.'; errEl.style.display = ''; return; }
    closePurchaseModal();
    loadFinancePurchases();
  } catch {
    errEl.textContent = 'Cannot connect.'; errEl.style.display = '';
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Record Purchase';
  }
}

function openSupplierPaymentModal(purchaseId, balanceDue) {
  document.getElementById('sup-pay-purchase-id').value = purchaseId;
  document.getElementById('sup-pay-balance').textContent = fmt(balanceDue);
  document.getElementById('sup-pay-amount').value = '';
  document.getElementById('sup-pay-amount').max = balanceDue;
  document.getElementById('sup-pay-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('sup-pay-ref').value = '';
  document.getElementById('sup-pay-error').style.display = 'none';
  document.getElementById('sup-pay-modal-overlay').style.display = '';
  document.getElementById('sup-pay-modal').style.display = '';
}

function closeSupplierPaymentModal() {
  document.getElementById('sup-pay-modal-overlay').style.display = 'none';
  document.getElementById('sup-pay-modal').style.display = 'none';
}

async function saveSupplierPayment(e) {
  e.preventDefault();
  const id     = document.getElementById('sup-pay-purchase-id').value;
  const errEl  = document.getElementById('sup-pay-error');
  const btn    = document.getElementById('sup-pay-btn');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await fetch(`/api/admin/purchases/${id}/payments`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount:          parseFloat(document.getElementById('sup-pay-amount').value),
        date:            document.getElementById('sup-pay-date').value,
        method:          document.getElementById('sup-pay-method').value,
        referenceNumber: document.getElementById('sup-pay-ref').value.trim()
      })
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Error.'; errEl.style.display = ''; return; }
    closeSupplierPaymentModal();
    loadFinancePurchases();
  } catch {
    errEl.textContent = 'Cannot connect.'; errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Save Payment';
  }
}


// ════════════════════════════════════════════════════════════
// FINANCE — REPORTS
// ════════════════════════════════════════════════════════════

let _currentReport = 'pnl';

function switchReport(type) {
  _currentReport = type;
  document.querySelectorAll('.report-btn').forEach(b => {
    b.classList.toggle('active', b.id === `report-btn-${type}`);
  });
  loadCurrentReport();
}

async function loadCurrentReport() {
  const period = document.getElementById('report-period')?.value || 'thisMonth';
  const el     = document.getElementById('fin-reports-content');
  el.innerHTML = '<p class="admin-loading">Loading report...</p>';
  try {
    let url, res, data;
    switch (_currentReport) {
      case 'pnl':
        res = await fetch(`/api/admin/reports/pnl?period=${period}`, { credentials: 'include' });
        data = await res.json();
        if (!res.ok) throw new Error(data.error);
        renderPnlReport(data, el);
        break;
      case 'balance-sheet':
        res = await fetch('/api/admin/reports/balance-sheet', { credentials: 'include' });
        data = await res.json();
        if (!res.ok) throw new Error(data.error);
        renderBalanceSheet(data, el);
        break;
      case 'cash-flow':
        res = await fetch(`/api/admin/reports/cash-flow?period=${period}`, { credentials: 'include' });
        data = await res.json();
        if (!res.ok) throw new Error(data.error);
        renderCashFlow(data, el);
        break;
      case 'sales':
        res = await fetch(`/api/admin/reports/sales?period=${period}`, { credentials: 'include' });
        data = await res.json();
        if (!res.ok) throw new Error(data.error);
        renderSalesReport(data, el);
        break;
      case 'rec-aging':
        res = await fetch('/api/admin/reports/receivables-aging', { credentials: 'include' });
        data = await res.json();
        if (!res.ok) throw new Error(data.error);
        renderRecAging(data, el);
        break;
      case 'pay-aging':
        res = await fetch('/api/admin/reports/payables-aging', { credentials: 'include' });
        data = await res.json();
        if (!res.ok) throw new Error(data.error);
        renderPayAging(data, el);
        break;
      case 'inventory':
        res = await fetch('/api/admin/reports/inventory', { credentials: 'include' });
        data = await res.json();
        if (!res.ok) throw new Error(data.error);
        renderInventoryReport(data, el);
        break;
    }
  } catch(err) {
    el.innerHTML = `<p class="admin-empty" style="color:var(--danger)">Error loading report: ${esc(err.message)}</p>`;
  }
}

function _reportHeader(title, subtitle) {
  return `<div style="padding:20px 24px 8px"><h3 style="margin:0;font-size:1.1rem">${title}</h3>${subtitle ? `<p style="margin:4px 0 0;color:var(--text-light);font-size:0.85rem">${subtitle}</p>` : ''}</div>`;
}

function _reportTable(headers, rows, totalRow) {
  const th = headers.map(h => `<th>${h}</th>`).join('');
  const tr = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  const foot = totalRow ? `<tfoot><tr>${totalRow.map(c => `<td><strong>${c}</strong></td>`).join('')}</tr></tfoot>` : '';
  return `<div class="admin-table-scroll"><table class="admin-table"><thead><tr>${th}</tr></thead><tbody>${tr || '<tr><td colspan="'+headers.length+'" style="text-align:center;color:var(--text-light)">No data</td></tr>'}</tbody>${foot}</table></div>`;
}

function renderPnlReport(d, el) {
  const p   = d.period;
  const pct = v => v.toFixed(1) + '%';
  const sign = v => v >= 0 ? `<span style="color:var(--success)">₱${fmt(v)}</span>` : `<span style="color:var(--danger)">−₱${fmt(Math.abs(v))}</span>`;

  const expRows = (d.operatingExpenses || []).filter(e => e.amount !== 0).map(e =>
    [`<span style="padding-left:16px;color:var(--text-light)">${esc(e.name)}</span>`, '', sign(e.amount)]
  );

  el.innerHTML = _reportHeader('Profit & Loss Statement', `${p.start} → ${p.end}`) + `
    <div style="max-width:560px;margin:0 24px 24px">
      <table style="width:100%;border-collapse:collapse;font-size:0.92rem">
        <tbody>
          <tr style="border-bottom:1px solid var(--border)"><td style="padding:8px 0">Gross Sales</td><td></td><td style="text-align:right">₱${fmt(d.grossSales)}</td></tr>
          <tr><td style="padding:4px 0 4px 16px;color:var(--text-light)">Less: Sales Discounts</td><td></td><td style="text-align:right;color:var(--text-light)">₱${fmt(d.salesDiscounts)}</td></tr>
          <tr style="border-bottom:2px solid var(--border)"><td style="padding:4px 0 8px 16px;color:var(--text-light)">Less: Sales Returns</td><td></td><td style="text-align:right;color:var(--text-light)">₱${fmt(d.salesReturns)}</td></tr>
          <tr style="border-bottom:1px solid var(--border)"><td style="padding:8px 0;font-weight:600">Net Sales</td><td></td><td style="text-align:right;font-weight:600">₱${fmt(d.netSales)}</td></tr>
          <tr><td style="padding:8px 0 4px 16px;color:var(--text-light)">Less: Cost of Goods Sold</td><td></td><td style="text-align:right;color:var(--text-light)">₱${fmt(d.cogs)}</td></tr>
          <tr style="border-bottom:2px solid var(--border)"><td style="padding:4px 0 8px;font-weight:600">Gross Profit</td><td style="text-align:right;color:var(--text-light);font-size:0.82rem">${pct(d.grossMargin)}</td><td style="text-align:right;font-weight:600">${sign(d.grossProfit)}</td></tr>
          ${expRows.length ? `<tr><td colspan="3" style="padding:8px 0 4px;font-weight:600;color:var(--text-light);font-size:0.85rem;text-transform:uppercase;letter-spacing:.5px">Operating Expenses</td></tr>` : ''}
          ${expRows.map(([n,,a]) => `<tr><td style="padding:3px 0">${n}</td><td></td><td style="text-align:right">${a}</td></tr>`).join('')}
          ${expRows.length ? `<tr style="border-top:1px solid var(--border)"><td style="padding:6px 0 4px;color:var(--text-light)">Total Operating Expenses</td><td></td><td style="text-align:right;color:var(--text-light)">₱${fmt(d.totalOperatingExpenses)}</td></tr>` : ''}
          <tr style="border-top:2px solid var(--text);background:var(--accent-light)"><td style="padding:10px 8px;font-weight:700;font-size:1rem">Net Profit</td><td style="text-align:right;color:var(--text-light);font-size:0.82rem">${pct(d.netMargin)}</td><td style="text-align:right;font-weight:700;font-size:1rem">${sign(d.netProfit)}</td></tr>
        </tbody>
      </table>
    </div>`;
}

function renderBalanceSheet(d, el) {
  const sign = v => v < 0 ? `<span style="color:var(--danger)">−₱${fmt(Math.abs(v))}</span>` : `₱${fmt(v)}`;
  const secRows = (arr) => arr.map(r => `<tr><td style="padding:4px 0 4px 16px;color:var(--text-light)">${esc(r.name)}</td><td style="text-align:right">${sign(r.amount)}</td></tr>`).join('');
  const balanced = d.isBalanced
    ? '<span style="color:var(--success);font-size:0.82rem">✓ Balanced</span>'
    : '<span style="color:var(--danger);font-size:0.82rem">⚠ Out of balance</span>';

  el.innerHTML = _reportHeader('Balance Sheet', `As of ${d.asOf} ${balanced}`) + `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:0 24px 24px;max-width:800px">
      <div>
        <h4 style="margin:0 0 8px;text-transform:uppercase;font-size:0.78rem;letter-spacing:1px;color:var(--text-light)">Assets</h4>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
          <tbody>${secRows(d.assets)}<tr style="border-top:2px solid var(--text)"><td style="padding:8px 0;font-weight:700">Total Assets</td><td style="text-align:right;font-weight:700">₱${fmt(d.totalAssets)}</td></tr></tbody>
        </table>
      </div>
      <div>
        <h4 style="margin:0 0 8px;text-transform:uppercase;font-size:0.78rem;letter-spacing:1px;color:var(--text-light)">Liabilities</h4>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
          <tbody>${secRows(d.liabilities)}<tr style="border-top:1px solid var(--border)"><td style="padding:8px 0;font-weight:600">Total Liabilities</td><td style="text-align:right;font-weight:600">₱${fmt(d.totalLiabilities)}</td></tr></tbody>
        </table>
        <h4 style="margin:16px 0 8px;text-transform:uppercase;font-size:0.78rem;letter-spacing:1px;color:var(--text-light)">Equity</h4>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem">
          <tbody>${secRows(d.equity)}<tr style="border-top:2px solid var(--text)"><td style="padding:8px 0;font-weight:700">Total Equity</td><td style="text-align:right;font-weight:700">₱${fmt(d.totalEquity)}</td></tr></tbody>
        </table>
      </div>
    </div>`;
}

function renderCashFlow(d, el) {
  const p    = d.period;
  const sign = v => v >= 0 ? `<span style="color:var(--success)">+₱${fmt(v)}</span>` : `<span style="color:var(--danger)">−₱${fmt(Math.abs(v))}</span>`;
  el.innerHTML = _reportHeader('Cash Flow Summary', `${p.start} → ${p.end}`) + `
    <div style="max-width:440px;margin:0 24px 24px">
      <table style="width:100%;border-collapse:collapse;font-size:0.92rem">
        <tbody>
          ${(d.accounts || []).map(a => `
            <tr><td colspan="2" style="padding:8px 0 2px;font-weight:600;font-size:0.85rem;color:var(--text-light)">${esc(a.name)}</td></tr>
            <tr><td style="padding:3px 0 3px 16px">Cash Inflows</td><td style="text-align:right;color:var(--success)">₱${fmt(a.inflows)}</td></tr>
            <tr style="border-bottom:1px solid var(--border)"><td style="padding:3px 0 8px 16px">Cash Outflows</td><td style="text-align:right;color:var(--danger)">₱${fmt(a.outflows)}</td></tr>`).join('')}
          <tr style="border-top:1px solid var(--border)"><td style="padding:8px 0">Total Inflows</td><td style="text-align:right;color:var(--success)">₱${fmt(d.totalInflows)}</td></tr>
          <tr><td style="padding:3px 0">Total Outflows</td><td style="text-align:right;color:var(--danger)">₱${fmt(d.totalOutflows)}</td></tr>
          <tr style="border-top:1px solid var(--border)"><td style="padding:8px 0;font-weight:600">Net Cash Flow</td><td style="text-align:right;font-weight:600">${sign(d.netCashFlow)}</td></tr>
          <tr style="background:var(--accent-light)"><td style="padding:8px;font-weight:700">Cash Balance (all time)</td><td style="text-align:right;font-weight:700">${sign(d.cashBalance)}</td></tr>
        </tbody>
      </table>
    </div>`;
}

function renderSalesReport(d, el) {
  const p = d.period;
  const s = d.summary;
  el.innerHTML = _reportHeader('Sales Report', `${p.start} → ${p.end}`) + `
    <div style="padding:0 24px 8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;max-width:900px">
      ${[
        ['Total Orders', s.totalOrders],
        ['Gross Revenue', '₱' + fmt(s.grossRevenue)],
        ['Discounts', '₱' + fmt(s.totalDiscounts)],
        ['Net Revenue', '₱' + fmt(s.netRevenue)],
        ['Avg Order', '₱' + fmt(s.avgOrderValue)],
        ['Collected', '₱' + fmt(s.collectedRevenue)]
      ].map(([l,v]) => `<div style="background:var(--accent-light);border-radius:8px;padding:12px 16px"><div style="font-size:0.78rem;color:var(--text-light);text-transform:uppercase;letter-spacing:.5px">${l}</div><div style="font-size:1.2rem;font-weight:700;margin-top:4px">${v}</div></div>`).join('')}
    </div>` +
    _reportHeader('Top Products', '') +
    _reportTable(['Product','Units Sold','Revenue','COGS'],
      (d.topProducts || []).map(r => [esc(r.name), r.units_sold, '₱'+fmt(r.revenue), '₱'+fmt(r.cogs)]));
}

function renderRecAging(d, el) {
  const bucketOrder = ['current','1-30 days','31-60 days','61-90 days','over 90 days'];
  const summaryRows = bucketOrder.map(b => {
    const bk = d.buckets[b];
    return bk ? `<tr><td>${b}</td><td>${bk.count}</td><td style="color:${b==='current'?'var(--success)':'var(--danger)'}">₱${fmt(bk.total)}</td></tr>` : '';
  }).join('');

  el.innerHTML = _reportHeader('Receivables Aging', `As of ${d.asOf}`) +
    `<div style="padding:0 24px 16px;max-width:400px"><table class="admin-table"><thead><tr><th>Bucket</th><th>Count</th><th>Amount</th></tr></thead><tbody>${summaryRows}</tbody><tfoot><tr><td><strong>Total</strong></td><td></td><td><strong>₱${fmt(d.totalOutstanding)}</strong></td></tr></tfoot></table></div>` +
    _reportHeader('Detail', '') +
    _reportTable(['Customer','Amount','Paid','Balance','Due Date','Bucket'],
      (d.receivables || []).map(r => [esc(r.customer_name), '₱'+fmt(r.amount), '₱'+fmt(r.amount_paid||0), `<span style="color:var(--danger)">₱${fmt(r.balance_due)}</span>`, r.due_date || '—', r.aging_bucket]));
}

function renderPayAging(d, el) {
  el.innerHTML = _reportHeader('Payables Aging', `As of ${d.asOf}`) +
    _reportTable(['Supplier','Description','Amount','Paid','Balance','Due Date','Bucket'],
      (d.payables || []).map(r => [esc(r.supplier_name), esc(r.description||'—'), '₱'+fmt(r.amount), '₱'+fmt(r.amount_paid||0), `<span style="color:var(--danger)">₱${fmt(r.balance_due??r.amount)}</span>`, r.due_date||'—', r.aging_bucket||'—']),
      ['','','','Total Outstanding','₱'+fmt(d.totalOutstanding),'','']);
}

function renderInventoryReport(d, el) {
  el.innerHTML = _reportHeader('Inventory Valuation', '') +
    `<div style="padding:0 24px 8px;display:flex;gap:24px;flex-wrap:wrap">
      <div style="background:var(--accent-light);border-radius:8px;padding:12px 20px"><div style="font-size:0.78rem;color:var(--text-light);text-transform:uppercase">Total Value</div><div style="font-size:1.3rem;font-weight:700;margin-top:4px">₱${fmt(d.totalValue||0)}</div></div>
      <div style="background:var(--accent-light);border-radius:8px;padding:12px 20px"><div style="font-size:0.78rem;color:var(--text-light);text-transform:uppercase">Items Tracked</div><div style="font-size:1.3rem;font-weight:700;margin-top:4px">${(d.items||[]).length}</div></div>
      ${(d.items||[]).filter(i=>i.is_low_stock).length ? `<div style="background:#fff3f3;border-radius:8px;padding:12px 20px;border:1px solid var(--danger)"><div style="font-size:0.78rem;color:var(--danger);text-transform:uppercase">Low Stock</div><div style="font-size:1.3rem;font-weight:700;margin-top:4px;color:var(--danger)">${(d.items||[]).filter(i=>i.is_low_stock).length}</div></div>` : ''}
    </div>` +
    _reportTable(['Product','Variant','Stock','Unit Cost','Value','Low Stock'],
      (d.items||[]).map(r => [esc(r.product_name||r.name||'—'), esc(r.variant||'Default'), r.stock_qty, '₱'+fmt(r.unit_cost||r.weighted_avg_cost||0), '₱'+fmt(r.total_value||0), r.is_low_stock ? '<span style="color:var(--danger)">⚠ Low</span>' : '']));
}


// ════════════════════════════════════════════════════════════
// FINANCE — LEDGER (Journal Entries)
// ════════════════════════════════════════════════════════════

async function loadFinanceLedger() {
  const el = document.getElementById('fin-ledger-content');
  el.innerHTML = '<p class="admin-loading">Loading journal entries...</p>';
  try {
    const res  = await fetch('/api/admin/journal-entries?limit=100', { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    renderLedger(data, el);
  } catch(err) {
    el.innerHTML = `<p class="admin-empty" style="color:var(--danger)">Error: ${esc(err.message)}</p>`;
  }
}

function renderLedger(entries, el) {
  if (!entries.length) {
    el.innerHTML = '<p class="admin-empty">No journal entries yet. Post an order, expense, or purchase to generate entries.</p>';
    return;
  }
  const rows = entries.map(je => {
    const lines = (je.lines || []).map(l => `
      <tr style="background:#fafafa">
        <td colspan="2" style="padding:4px 8px 4px 32px;font-size:0.82rem;color:var(--text-light)">${esc(l.account_code)} ${esc(l.account_name)}</td>
        <td style="padding:4px 8px;font-size:0.82rem;text-align:right;color:var(--success)">${parseFloat(l.debit)>0 ? '₱'+fmt(l.debit) : ''}</td>
        <td style="padding:4px 8px;font-size:0.82rem;text-align:right;color:var(--danger)">${parseFloat(l.credit)>0 ? '₱'+fmt(l.credit) : ''}</td>
        <td colspan="2" style="padding:4px 8px;font-size:0.82rem;color:var(--text-light)">${esc(l.description||'')}</td>
      </tr>`).join('');
    const totalDebit  = (je.lines||[]).reduce((s,l)=>s+parseFloat(l.debit||0),0);
    const totalCredit = (je.lines||[]).reduce((s,l)=>s+parseFloat(l.credit||0),0);
    return `
      <tr style="cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none'">
        <td>${je.date}</td>
        <td><strong>${esc(je.description)}</strong></td>
        <td style="text-align:right;color:var(--success)">₱${fmt(totalDebit)}</td>
        <td style="text-align:right;color:var(--danger)">₱${fmt(totalCredit)}</td>
        <td><span style="font-size:0.78rem;background:var(--accent-light);padding:2px 7px;border-radius:10px">${esc(je.ref_type||'manual')}</span></td>
        <td style="font-size:0.78rem;color:var(--text-light)">${esc(je.posted_by_name||'—')}</td>
      </tr>
      <tr style="display:none"><td colspan="6" style="padding:0;border-bottom:2px solid var(--border)">
        <table style="width:100%;border-collapse:collapse">
          <tbody>${lines}</tbody>
        </table>
      </td></tr>`;
  }).join('');

  el.innerHTML = `
    <div style="padding:12px 24px;background:var(--accent-light);border-bottom:1px solid var(--border);font-size:0.85rem;color:var(--text-light)">
      ${entries.length} entries — click any row to expand lines
    </div>
    <div class="admin-table-scroll"><table class="admin-table">
      <thead><tr>
        <th>Date</th><th>Description</th><th>Dr</th><th>Cr</th><th>Type</th><th>Posted By</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}


// ════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════

async function loadSettings() {
  try {
    const res      = await fetch('/api/admin/settings', { credentials: 'include' });
    const settings = await res.json();

    document.getElementById('setting-points-enabled').checked  = !!settings.pointsSystemEnabled;
    document.getElementById('setting-purchase-rate').value     = settings.purchasePointsRate ?? 1;
    document.getElementById('setting-referral-pts').value      = settings.referralRewardPoints ?? 50;
    document.getElementById('setting-shipping-fee').value      = settings.shippingFee ?? 0;
    document.getElementById('setting-facebook-url').value      = settings.facebookUrl  || '';
    document.getElementById('setting-instagram-url').value     = settings.instagramUrl || '';
    document.getElementById('setting-telegram-url').value      = settings.telegramUrl  || '';

    // Show current QR code
    const qrBox = document.getElementById('qr-preview-box');
    if (settings.paymentQrCodePath) {
      qrBox.innerHTML = `
        <img src="${settings.paymentQrCodePath}" alt="Current QR Code"
          style="max-width:200px;max-height:200px;border:2px solid var(--border);border-radius:8px;display:block" />
        <p style="font-size:0.8rem;color:var(--text-light);margin-top:6px">Current payment QR code</p>`;
    } else {
      qrBox.innerHTML = `<p style="color:var(--text-light);font-size:0.9rem">No QR code uploaded yet.</p>`;
    }
  } catch {
    console.error('Could not load settings.');
  }
}

async function savePointsSettings(event) {
  event.preventDefault();
  try {
    const msg = document.getElementById('settings-points-msg');
    msg.style.display = 'none';

    const body = {
      pointsSystemEnabled:  document.getElementById('setting-points-enabled').checked,
      purchasePointsRate:   parseFloat(document.getElementById('setting-purchase-rate').value) || 1,
      referralRewardPoints: parseInt(document.getElementById('setting-referral-pts').value) || 50,
      shippingFee:          parseFloat(document.getElementById('setting-shipping-fee').value) || 0
    };

    const res = await fetch('/api/admin/settings', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (res.ok) {
      msg.style.display = '';
      setTimeout(() => msg.style.display = 'none', 3000);
    } else {
      alert('Could not save settings.');
    }
  } catch { alert('Could not save settings.'); }
}

async function saveSocialSettings(event) {
  event.preventDefault();
  try {
    const msg = document.getElementById('settings-social-msg');
    msg.style.display = 'none';

    const body = {
      facebookUrl:  document.getElementById('setting-facebook-url').value.trim(),
      instagramUrl: document.getElementById('setting-instagram-url').value.trim(),
      telegramUrl:  document.getElementById('setting-telegram-url').value.trim()
    };

    const res = await fetch('/api/admin/settings', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (res.ok) {
      msg.style.display = '';
      setTimeout(() => msg.style.display = 'none', 3000);
    } else {
      alert('Could not save social links.');
    }
  } catch { alert('Could not save social links.'); }
}

function previewQRFile(input) {
  const file = input.files[0];
  if (!file) return;
  const preview = document.getElementById('qr-file-preview');
  const label   = document.getElementById('qr-file-text');
  const reader  = new FileReader();
  reader.onload = e => {
    preview.src = e.target.result;
    preview.style.display = '';
    label.style.display   = 'none';
  };
  reader.readAsDataURL(file);
}

async function uploadQRCode(event) {
  event.preventDefault();
  const file = document.getElementById('qr-file').files[0];
  const msg  = document.getElementById('qr-upload-msg');
  msg.style.display = 'none';

  if (!file) { alert('Please select an image first.'); return; }

  const formData = new FormData();
  formData.append('qr', file);

  try {
    const res  = await fetch('/api/admin/settings/qr', {
      method: 'POST', credentials: 'include', body: formData
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON response */ }
    if (res.ok) {
      msg.style.display = '';
      setTimeout(() => msg.style.display = 'none', 3000);
      loadSettings(); // refresh preview
    } else {
      alert(data.error || `Upload failed (HTTP ${res.status}). Is the server running?`);
    }
  } catch (err) {
    alert('Upload error: ' + (err.message || 'Cannot reach server.'));
  }
}


// ════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ════════════════════════════════════════════════════════════

// Formats a number as Philippine peso with 2 decimal places
function fmt(num) {
  return parseFloat(num || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Brief toast notification that auto-hides
function showToast(msg) {
  let toast = document.getElementById('admin-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'admin-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:var(--accent);color:#fff;padding:10px 20px;border-radius:8px;font-size:0.9rem;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2)';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.style.opacity = '0', 2500);
}
