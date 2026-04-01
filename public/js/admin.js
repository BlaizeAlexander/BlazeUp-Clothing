// ============================================================
// admin.js — Admin Dashboard JavaScript
// Covers: products, orders, customers, discounts,
//         finance (inventory, prices, receivables, payables, expenses),
//         and store settings (points, QR code)
// ============================================================

// ── On page load ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkAdminAccess();  // redirect away if not admin
  loadAdminProducts();       // default tab
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
  const tabs = ['products','orders','customers','discounts','finance','settings'];
  tabs.forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`panel-${t}`).style.display = t === tab ? '' : 'none';
  });

  // Stop any previous customers auto-refresh
  if (_customersPollingTimer) { clearInterval(_customersPollingTimer); _customersPollingTimer = null; }

  // Load data for the selected tab
  if (tab === 'orders')    loadAdminOrders();
  if (tab === 'customers') {
    loadAdminCustomers();
    // Auto-refresh every 20 seconds while on this tab so name changes show without manual refresh
    _customersPollingTimer = setInterval(loadAdminCustomers, 20000);
  }
  if (tab === 'discounts') loadAdminDiscounts();
  if (tab === 'finance')   { switchFinTab('overview'); loadFinanceOverview(); }
  if (tab === 'settings')  loadSettings();
}


// ════════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════════

async function loadAdminProducts() {
  const wrap = document.getElementById('products-table-wrap');
  try {
    const res      = await fetch('/api/products', { credentials: 'include' });
    const products = await res.json();

    if (!products.length) {
      wrap.innerHTML = '<p class="admin-empty">No products yet. Click "Add New Product" to get started.</p>';
      return;
    }

    wrap.innerHTML = `<div class="admin-table-scroll">
      <table class="admin-table">
        <thead><tr>
          <th>Photo</th><th>Name</th><th>Category</th>
          <th>Price</th><th>Stock</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${products.map(p => {
            const imgs     = p.images && p.images.length ? p.images : [p.image];
            const variants = p.variants && p.variants.length
              ? p.variants.map(v => `<span class="variant-tag">${v.name} ₱${v.price}</span>`).join(' ')
              : '<span style="color:var(--text-light);font-size:0.8rem">—</span>';
            const stock    = p.stockQuantity !== undefined ? p.stockQuantity : '—';
            const lowStock = typeof p.stockQuantity === 'number' && p.stockQuantity <= 5
              ? '<span class="low-stock-badge">Low</span>' : '';
            return `
              <tr>
                <td>
                  <div class="admin-img-preview-row" style="gap:4px">
                    ${imgs.slice(0,3).map(src => `
                      <img src="${src}" alt="${p.name}" class="admin-product-thumb"
                        onerror="this.style.background='#e8f5e8';this.src=''" />`).join('')}
                  </div>
                </td>
                <td>
                  <strong>${p.name}</strong><br/>
                  <small style="color:var(--text-light)">${variants}</small>
                </td>
                <td style="font-size:0.85rem;color:var(--text-light)">${p.category || '—'}</td>
                <td class="admin-price-cell">₱${parseFloat(p.price).toFixed(2)}</td>
                <td>${stock} ${lowStock}</td>
                <td class="admin-actions-cell">
                  <button class="btn btn-small admin-edit-btn" onclick="openEditModal('${p.id}')">✏️ Edit</button>
                  <button class="btn btn-small admin-delete-btn" onclick="deleteProduct('${p.id}','${p.name.replace(/'/g,"\\'")}')">🗑️ Delete</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
  } catch {
    wrap.innerHTML = '<p class="admin-empty">Could not load products.</p>';
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
    loadAdminProducts();
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
  if (res.ok) loadAdminProducts();
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
          <th>Items</th><th>Total</th><th>Screenshot</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${orders.map(o => `
            <tr>
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
    const res       = await fetch('/api/admin/customers', { credentials: 'include' });
    const customers = await res.json();

    badge.textContent   = customers.length;
    badge.style.display = customers.length ? '' : 'none';

    if (!customers.length) { wrap.innerHTML = '<p class="admin-empty">No customers yet.</p>'; return; }

    wrap.innerHTML = `<div class="admin-table-scroll">
      <table class="admin-table customers-table">
        <thead><tr>
          <th>#</th><th>Username</th><th>Email</th><th>Contact</th>
          <th>⭐ Points</th><th>Referred</th><th>Joined</th><th></th>
        </tr></thead>
        <tbody>
          ${customers.map((c, i) => `
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
                  onclick='showCustomerDetail(${JSON.stringify(c)})'>View</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch {
    wrap.innerHTML = '<p class="admin-empty">Could not load customers.</p>';
  }
}

function showCustomerDetail(customer) {
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

  document.getElementById('customer-detail-body').innerHTML = `
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
  const finTabs = ['overview','inventory','prices','receivables','payables','expenses'];
  finTabs.forEach(t => {
    document.getElementById(`fin-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`fin-panel-${t}`).style.display = t === tab ? '' : 'none';
  });
  if (tab === 'overview')     loadFinanceOverview();
  if (tab === 'inventory')    loadFinanceInventory();
  if (tab === 'prices')       loadFinancePrices();
  if (tab === 'receivables')  loadFinanceReceivables();
  if (tab === 'payables')     loadFinancePayables();
  if (tab === 'expenses')     loadFinanceExpenses();
}


// ════════════════════════════════════════════════════════════
// FINANCE — OVERVIEW
// ════════════════════════════════════════════════════════════

async function loadFinanceOverview(period) {
  const el        = document.getElementById('fin-overview-content');
  const periodSel = document.getElementById('fin-period-select');
  const p         = period || (periodSel ? periodSel.value : 'allTime');

  try {
    const res = await fetch(`/api/admin/finance/overview?period=${p}`, { credentials: 'include' });
    const d   = await res.json();

    // Helper: format positive/negative with color
    const signed = (v) => {
      const cls = v >= 0 ? 'kpi-positive' : 'kpi-negative';
      return { val: '₱' + fmt(Math.abs(v)), cls, prefix: v < 0 ? '−' : '' };
    };
    const gp  = signed(d.grossProfit);
    const op  = signed(d.operatingProfit);
    const cp  = signed(d.estCashPosition);

    el.innerHTML = `
      <div class="fin-kpi-grid">
        ${kpiCard('📦 Inventory Value',      '₱' + fmt(d.inventoryValue),        'Current stock × cost price of each product')}
        ${kpiCard('💰 Total Revenue',        '₱' + fmt(d.totalRevenue),          `${d.paidOrders} confirmed/shipped/delivered orders`)}
        ${kpiCard('⏳ Pending Revenue',       '₱' + fmt(d.pendingRevenue),        `${d.pendingOrders} orders awaiting confirmation`)}
        ${kpiCard('🏭 Cost of Goods Sold',   '₱' + fmt(d.cogs),                  'Sum of item cost × qty for confirmed orders')}
        ${kpiCard('📈 Gross Profit',         gp.prefix + gp.val,                 'Revenue − Cost of Goods Sold', gp.cls)}
        ${kpiCard('💸 Operating Expenses',   '₱' + fmt(d.totalExpenses),         'All recorded business expenses')}
        ${kpiCard('💵 Operating Profit',     op.prefix + op.val,                 'Gross Profit − Expenses', op.cls)}
        ${kpiCard('🧾 Outstanding Receivables', '₱' + fmt(d.outstandingReceivables), 'Money owed to you (pending/overdue)')}
        ${kpiCard('📤 Outstanding Payables', '₱' + fmt(d.outstandingPayables),   'Money you owe (unpaid/partial)')}
        ${kpiCard('🏦 Est. Cash Position',   cp.prefix + cp.val,                 'Operating Profit − Outstanding Payables', cp.cls)}
      </div>
      <div style="margin-top:16px;padding:12px 20px;background:var(--accent-light);border-radius:6px;font-size:0.82rem;color:var(--text-light)">
        <strong>Formulas used:</strong>
        Gross Profit = Revenue − COGS &nbsp;|&nbsp;
        Operating Profit = Gross Profit − Expenses &nbsp;|&nbsp;
        Est. Cash Position = Operating Profit − Outstanding Payables
      </div>`;
  } catch {
    el.innerHTML = '<p class="admin-empty">Could not load overview.</p>';
  }
}

function kpiCard(label, value, sub, extraClass = '') {
  return `
    <div class="fin-kpi-card ${extraClass}">
      <p class="fin-kpi-label">${label}</p>
      <p class="fin-kpi-value">${value}</p>
      <p class="fin-kpi-sub">${sub}</p>
    </div>`;
}


// ════════════════════════════════════════════════════════════
// FINANCE — INVENTORY
// ════════════════════════════════════════════════════════════

async function loadFinanceInventory() {
  const el = document.getElementById('fin-inventory-content');
  try {
    const res      = await fetch('/api/products', { credentials: 'include' });
    const products = await res.json();

    if (!products.length) { el.innerHTML = '<p class="admin-empty">No products found.</p>'; return; }

    const inventoryValue = products.reduce((s, p) => s + ((p.costPrice || 0) * (p.stockQuantity || 0)), 0);

    el.innerHTML = `
      <div style="padding:16px 24px 8px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <p style="font-size:0.9rem;color:var(--text-light)">
          Total Inventory Value: <strong style="color:var(--primary)">₱${fmt(inventoryValue)}</strong>
        </p>
        <p style="font-size:0.8rem;color:var(--text-light)">
          ⚠️ Items with qty ≤ 5 are flagged as low stock.
        </p>
      </div>
      <div class="admin-table-scroll"><table class="admin-table">
        <thead><tr>
          <th>Product</th><th>Category</th><th>Stock</th><th>Cost Price</th>
          <th>Inventory Value</th><th>Update</th>
        </tr></thead>
        <tbody>
          ${products.map(p => {
            const stock = p.stockQuantity !== undefined ? p.stockQuantity : null;
            const cost  = p.costPrice || 0;
            const value = (cost * (stock || 0)).toFixed(2);
            const low   = typeof stock === 'number' && stock <= 5;
            return `
              <tr class="${low ? 'low-stock-row' : ''}">
                <td><strong>${p.name}</strong></td>
                <td>${p.category || '—'}</td>
                <td>
                  ${stock !== null ? stock : '—'}
                  ${low ? '<span class="low-stock-badge">Low Stock</span>' : ''}
                </td>
                <td>₱${parseFloat(cost).toFixed(2)}</td>
                <td class="admin-price-cell">₱${value}</td>
                <td>
                  <button class="btn btn-small admin-edit-btn"
                    onclick="openInventoryModal('${p.id}','${p.name.replace(/'/g,"\\'")}',${stock||0},${cost},'${p.category||''}')">
                    Update
                  </button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
  } catch {
    el.innerHTML = '<p class="admin-empty">Could not load inventory.</p>';
  }
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
    loadFinanceInventory();
    loadAdminProducts(); // refresh products tab too
  } catch {
    errorBox.textContent = 'Cannot connect.';
    errorBox.style.display = '';
  }
}


// ════════════════════════════════════════════════════════════
// FINANCE — PRICES
// ════════════════════════════════════════════════════════════

async function loadFinancePrices() {
  const el = document.getElementById('fin-prices-content');
  try {
    const res      = await fetch('/api/products', { credentials: 'include' });
    const products = await res.json();
    if (!products.length) { el.innerHTML = '<p class="admin-empty">No products yet.</p>'; return; }

    el.innerHTML = `
      <table class="admin-table">
        <thead><tr>
          <th>Product</th><th>Cost Price (₱)</th><th>Selling Price (₱)</th>
          <th>Margin (%)</th><th>Action</th>
        </tr></thead>
        <tbody>
          ${products.map(p => {
            const cost   = parseFloat(p.costPrice || 0);
            const sell   = parseFloat(p.price || 0);
            const margin = sell > 0 && cost > 0 ? ((sell - cost) / sell * 100).toFixed(1) : '—';
            const marginColor = typeof margin === 'string' && margin !== '—'
              ? (parseFloat(margin) < 20 ? '#dc3545' : parseFloat(margin) < 40 ? '#ffc107' : '#28a745')
              : 'var(--text-light)';
            return `
              <tr>
                <td><strong>${p.name}</strong></td>
                <td>
                  <input type="number" class="price-cost-input" data-id="${p.id}"
                    value="${cost.toFixed(2)}" min="0" step="0.01"
                    style="width:100px;padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:0.9rem"
                    onchange="updatePriceInline('${p.id}', this, 'cost')" />
                </td>
                <td>
                  <input type="number" class="price-sell-input" data-id="${p.id}"
                    value="${sell.toFixed(2)}" min="0" step="0.01"
                    style="width:100px;padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:0.9rem"
                    onchange="updatePriceInline('${p.id}', this, 'sell')" />
                </td>
                <td>
                  <span class="margin-badge" id="margin-${p.id}"
                    style="color:${marginColor};font-weight:700">
                    ${margin !== '—' ? margin + '%' : '—'}
                  </span>
                </td>
                <td>
                  <button class="btn btn-small btn-outline" onclick="savePriceRow('${p.id}')">Save</button>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
      <p style="padding:12px 20px;font-size:0.8rem;color:var(--text-light)">
        Edit cost and selling prices inline, then click Save to update.
      </p>`;
  } catch {
    el.innerHTML = '<p class="admin-empty">Could not load prices.</p>';
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
// SETTINGS
// ════════════════════════════════════════════════════════════

async function loadSettings() {
  try {
    const res      = await fetch('/api/admin/settings', { credentials: 'include' });
    const settings = await res.json();

    document.getElementById('setting-points-enabled').checked = !!settings.pointsSystemEnabled;
    document.getElementById('setting-purchase-rate').value    = settings.purchasePointsRate ?? 1;
    document.getElementById('setting-referral-pts').value     = settings.referralRewardPoints ?? 50;
    document.getElementById('setting-shipping-fee').value     = settings.shippingFee ?? 0;

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
