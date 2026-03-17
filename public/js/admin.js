// ============================================================
// admin.js — JavaScript for the Admin Dashboard
// Handles: products table, add/edit/delete product,
//          orders table, screenshot viewer
// ============================================================

// ── On page load ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkAdminAccess();  // Redirect if not admin
  loadAdminProducts();       // Load products tab by default
  loadAdminOrders();         // Load orders in background
  loadAdminDiscounts();      // Load discounts in background
});

// ── checkAdminAccess() ───────────────────────────────────────
// Verify the logged-in user is an admin. Redirect if not.
async function checkAdminAccess() {
  try {
    const res  = await fetch('/api/admin/check', { credentials: 'include' });
    const data = await res.json();
    if (!data.isAdmin) {
      window.location.href = 'login.html';
    }
  } catch {
    window.location.href = 'login.html';
  }
}

// ── adminLogout() ─────────────────────────────────────────────
async function adminLogout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  window.location.href = 'index.html';
}


// ════════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════════

function switchTab(tab) {
  ['products', 'orders', 'customers', 'discounts'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`panel-${t}`).style.display = t === tab ? '' : 'none';
  });

  if (tab === 'orders')    loadAdminOrders();
  if (tab === 'customers') loadAdminCustomers();
  if (tab === 'discounts') loadAdminDiscounts();
}


// ════════════════════════════════════════════════════════════
// PRODUCTS
// ════════════════════════════════════════════════════════════

// ── loadAdminProducts() ──────────────────────────────────────
async function loadAdminProducts() {
  const wrap = document.getElementById('products-table-wrap');
  try {
    const res      = await fetch('/api/products', { credentials: 'include' });
    const products = await res.json();

    if (products.length === 0) {
      wrap.innerHTML = '<p class="admin-empty">No products yet. Click "Add New Product" to get started.</p>';
      return;
    }

    // Build a table row for each product
    wrap.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Photo</th>
            <th>Name</th>
            <th>Description</th>
            <th>Price</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${products.map(p => {
            const imgs     = p.images && p.images.length > 0 ? p.images : [p.image];
            const variants = p.variants && p.variants.length > 0
              ? p.variants.map(v => `<span class="variant-tag">${v.name} ₱${v.price}</span>`).join(' ')
              : '<span style="color:var(--text-light);font-size:0.8rem">—</span>';
            return `
            <tr>
              <td>
                <div class="admin-img-preview-row" style="gap:4px">
                  ${imgs.slice(0, 3).map(src => `
                    <img src="${src}" alt="${p.name}" class="admin-product-thumb"
                      onerror="this.style.background='#e8f5e8';this.src=''" />
                  `).join('')}
                  ${imgs.length > 3 ? `<span style="font-size:0.78rem;color:var(--text-light)">+${imgs.length-3}</span>` : ''}
                </div>
              </td>
              <td><strong>${p.name}</strong><br/><small style="color:var(--text-light)">${variants}</small></td>
              <td class="admin-desc-cell">${p.description}</td>
              <td class="admin-price-cell">₱${parseFloat(p.price).toFixed(2)}</td>
              <td class="admin-actions-cell">
                <button class="btn btn-small admin-edit-btn" onclick="openEditModal('${p.id}')">
                  ✏️ Edit
                </button>
                <button class="btn btn-small admin-delete-btn" onclick="deleteProduct('${p.id}', '${p.name.replace(/'/g, "\\'")}')">
                  🗑️ Delete
                </button>
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch {
    wrap.innerHTML = '<p class="admin-empty">Could not load products.</p>';
  }
}

// ── openProductModal() ────────────────────────────────────────
// Open the Add New Product modal (blank form)
function openProductModal() {
  document.getElementById('product-modal-title').textContent    = 'Add New Product';
  document.getElementById('product-id').value                   = '';
  document.getElementById('product-name').value                 = '';
  document.getElementById('product-desc').value                 = '';
  document.getElementById('product-price').value                = '';
  document.getElementById('product-images').value               = '';
  document.getElementById('product-img-previews').innerHTML     = '';
  document.getElementById('product-file-text').style.display    = '';
  document.getElementById('product-form-error').style.display   = 'none';
  document.getElementById('photo-optional-label').style.display = 'none';
  document.getElementById('price-tiers-container').innerHTML    = '';
  document.getElementById('variants-container').innerHTML       = '';

  const saveBtn     = document.getElementById('product-save-btn');
  saveBtn.textContent = 'Save Product';
  saveBtn.disabled    = false;   // always reset in case previous save got stuck

  document.getElementById('product-modal').classList.add('open');
  document.getElementById('product-modal-overlay').classList.add('open');
}

// ── openEditModal() ───────────────────────────────────────────
// Open the Edit Product modal pre-filled with the product's data
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
    document.getElementById('product-price').value                = p.price;
    document.getElementById('product-form-error').style.display   = 'none';
    document.getElementById('photo-optional-label').style.display = '';

    const saveBtn       = document.getElementById('product-save-btn');
    saveBtn.textContent = 'Update Product';
    saveBtn.disabled    = false;

    // Show current product images as previews
    const previewRow     = document.getElementById('product-img-previews');
    previewRow.innerHTML = '';
    const existingImages = p.images && p.images.length > 0 ? p.images : (p.image ? [p.image] : []);
    existingImages.forEach(src => {
      const img       = document.createElement('img');
      img.src         = src;
      img.className   = 'admin-img-thumb';
      previewRow.appendChild(img);
    });
    if (existingImages.length > 0) document.getElementById('product-file-text').style.display = 'none';
    document.getElementById('product-images').value = '';

    // Load existing price tiers
    document.getElementById('price-tiers-container').innerHTML = '';
    if (p.priceTiers && p.priceTiers.length > 0) {
      p.priceTiers.forEach(t => addTierRow(t.minQty, t.price));
    }

    // Load existing variants
    document.getElementById('variants-container').innerHTML = '';
    if (p.variants && p.variants.length > 0) {
      p.variants.forEach(v => addVariantRow(v.name, v.price));
    }

    document.getElementById('product-modal').classList.add('open');
    document.getElementById('product-modal-overlay').classList.add('open');

  } catch (err) {
    alert('Could not load product: ' + (err.message || 'Unknown error'));
  }
}

// ── closeProductModal() ───────────────────────────────────────
function closeProductModal() {
  document.getElementById('product-modal').classList.remove('open');
  document.getElementById('product-modal-overlay').classList.remove('open');
}

// ── Price Tier Helpers ────────────────────────────────────────
let tierRowCount = 0;

function addTierRow(minQty = '', price = '') {
  const id  = tierRowCount++;
  const row = document.createElement('div');
  row.className = 'tier-row';
  row.id        = `tier-row-${id}`;
  row.innerHTML = `
    <input type="number" class="tier-minqty" placeholder="Min Qty" value="${minQty}" min="1" step="1" />
    <input type="number" class="tier-price"  placeholder="Price ₱" value="${price}"  min="0" step="0.01" />
    <button type="button" class="tier-remove-btn" onclick="removeTierRow('tier-row-${id}')">✕</button>
  `;
  document.getElementById('price-tiers-container').appendChild(row);
}

function removeTierRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
}

function collectTiers() {
  const rows  = document.querySelectorAll('#price-tiers-container .tier-row');
  const tiers = [];
  rows.forEach(row => {
    const minQty = parseInt(row.querySelector('.tier-minqty').value);
    const price  = parseFloat(row.querySelector('.tier-price').value);
    if (!isNaN(minQty) && !isNaN(price)) {
      tiers.push({ minQty, price });
    }
  });
  return tiers.sort((a, b) => a.minQty - b.minQty);
}

// ── Variant (size) Helpers ────────────────────────────────────
let variantRowCount = 0;

function addVariantRow(name = '', price = '') {
  const id  = variantRowCount++;
  const row = document.createElement('div');
  row.className = 'tier-row';
  row.id        = `variant-row-${id}`;
  row.innerHTML = `
    <input type="text"   class="variant-name"  placeholder='e.g. "Small"' value="${name}" />
    <input type="number" class="variant-price" placeholder="Price ₱" value="${price}" min="0" step="0.01" />
    <button type="button" class="tier-remove-btn" onclick="removeVariantRow('variant-row-${id}')">✕</button>
  `;
  document.getElementById('variants-container').appendChild(row);
}

function removeVariantRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
}

function collectVariants() {
  const rows     = document.querySelectorAll('#variants-container .tier-row');
  const variants = [];
  rows.forEach(row => {
    const name  = row.querySelector('.variant-name').value.trim();
    const price = parseFloat(row.querySelector('.variant-price').value);
    if (name && !isNaN(price)) variants.push({ name, price });
  });
  return variants;
}

// ── previewProductImages() ────────────────────────────────────
// Show thumbnails of all selected product images
function previewProductImages(input) {
  const files   = input.files;
  const row     = document.getElementById('product-img-previews');
  const label   = document.getElementById('product-file-text');
  row.innerHTML = '';
  if (!files.length) return;
  label.style.display = 'none';
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement('img');
      img.src = e.target.result;
      img.className = 'admin-img-thumb';
      row.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

// ── saveProduct() ─────────────────────────────────────────────
// Handles both Add (POST) and Edit (PUT) product form submission
async function saveProduct(event) {
  event.preventDefault();

  const id          = document.getElementById('product-id').value;
  const name        = document.getElementById('product-name').value.trim();
  const description = document.getElementById('product-desc').value.trim();
  const price       = document.getElementById('product-price').value;
  const imageFiles  = document.getElementById('product-images').files;
  const errorBox    = document.getElementById('product-form-error');
  const saveBtn     = document.getElementById('product-save-btn');

  errorBox.style.display = 'none';
  saveBtn.disabled       = true;
  saveBtn.textContent    = 'Saving...';

  // Build FormData (needed to send files + text together)
  const formData = new FormData();
  formData.append('name',        name);
  formData.append('description', description);
  formData.append('price',       price);
  formData.append('priceTiers',  JSON.stringify(collectTiers()));
  formData.append('variants',    JSON.stringify(collectVariants()));
  // Attach all selected images under the field name 'images'
  Array.from(imageFiles).forEach(file => formData.append('images', file));

  const isEditing = !!id;
  const url    = isEditing ? `/api/admin/products/${id}` : '/api/admin/products';
  const method = isEditing ? 'PUT' : 'POST';

  // Safety: re-enable button after 10 seconds if server never responds
  const safetyTimer = setTimeout(() => {
    saveBtn.disabled       = false;
    saveBtn.textContent    = isEditing ? 'Update Product' : 'Save Product';
    errorBox.textContent   = 'Server is not responding. Make sure the server is running and restart it.';
    errorBox.style.display = '';
  }, 10000);

  try {
    const res  = await fetch(url, { method, credentials: 'include', body: formData });
    clearTimeout(safetyTimer);

    // Safely parse JSON — server may return HTML on crash
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON response */ }

    if (!res.ok) {
      errorBox.textContent   = data.error || `Server error ${res.status}. Try restarting the server.`;
      errorBox.style.display = '';
      saveBtn.disabled       = false;
      saveBtn.textContent    = isEditing ? 'Update Product' : 'Save Product';
      return;
    }

    closeProductModal();
    loadAdminProducts(); // Refresh the table

  } catch (err) {
    clearTimeout(safetyTimer);
    errorBox.textContent   = err.message || 'Cannot reach server. Make sure it is running.';
    errorBox.style.display = '';
    saveBtn.disabled       = false;
    saveBtn.textContent    = isEditing ? 'Update Product' : 'Save Product';
  }
}

// ── deleteProduct() ───────────────────────────────────────────
async function deleteProduct(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

  const res = await fetch(`/api/admin/products/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  if (res.ok) {
    loadAdminProducts();
  } else {
    alert('Could not delete product. Please try again.');
  }
}


// ════════════════════════════════════════════════════════════
// ORDERS
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════════

// ── loadAdminCustomers() ──────────────────────────────────────
async function loadAdminCustomers() {
  const wrap  = document.getElementById('customers-list-wrap');
  const badge = document.getElementById('customer-count-badge');
  closeCustomerDetail();

  try {
    const res       = await fetch('/api/admin/customers', { credentials: 'include' });
    const customers = await res.json();

    badge.textContent   = customers.length;
    badge.style.display = customers.length > 0 ? '' : 'none';

    if (customers.length === 0) {
      wrap.innerHTML = '<p class="admin-empty">No registered customers yet.</p>';
      return;
    }

    wrap.innerHTML = `
      <table class="admin-table customers-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Username</th>
            <th>Email</th>
            <th>Referred Friends</th>
            <th>Referred By</th>
            <th>Joined</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${customers.map((c, i) => `
            <tr class="customer-row" id="customer-row-${c.id}">
              <td style="color:var(--text-light)">${i + 1}</td>
              <td>
                <strong>${c.username}</strong>
                ${c.isAdmin ? '<span class="admin-badge">Admin</span>' : ''}
              </td>
              <td>${c.email}</td>
              <td>${c.referralCount} friend${c.referralCount !== 1 ? 's' : ''}</td>
              <td>${c.referredBy || '<span style="color:var(--text-light)">—</span>'}</td>
              <td class="date-cell">${formatDate(c.createdAt)}</td>
              <td>
                <button class="btn btn-small admin-edit-btn"
                  onclick='showCustomerDetail(${JSON.stringify(c)})'>
                  View Details
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

  } catch {
    wrap.innerHTML = '<p class="admin-empty">Could not load customers.</p>';
  }
}

// ── showCustomerDetail() ──────────────────────────────────────
// Shows the detail card when a customer row is clicked
function showCustomerDetail(customer) {
  const detail = document.getElementById('customer-detail');
  const body   = document.getElementById('customer-detail-body');

  document.getElementById('detail-username').textContent = `@${customer.username}`;

  const ordersHTML = customer.orders && customer.orders.length > 0
    ? `<div class="detail-orders">
        ${customer.orders.map(o => `
          <div class="detail-order-row">
            <span class="date-cell">${formatDate(o.createdAt)}</span>
            <span>${o.items.map(i => `${i.name} ×${i.qty}`).join(', ')}</span>
            <strong>₱${parseFloat(o.total).toFixed(2)}</strong>
            <span class="status-select status-${o.status}" style="padding:3px 10px;border-radius:20px;font-size:0.78rem">
              ${o.status}
            </span>
          </div>
        `).join('')}
      </div>`
    : '<p style="color:var(--text-light);font-size:0.88rem;margin-top:6px">No orders found for this account.</p>';

  body.innerHTML = `
    <div class="detail-grid">
      <div class="detail-item">
        <span class="detail-label">Username</span>
        <span class="detail-value">@${customer.username}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Email</span>
        <span class="detail-value">${customer.email}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Referral Code</span>
        <span class="detail-value code-style">${customer.referralCode}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Friends Referred</span>
        <span class="detail-value">${customer.referralCount}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Referred By</span>
        <span class="detail-value">${customer.referredBy || 'Direct sign-up'}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Member Since</span>
        <span class="detail-value">${formatDate(customer.createdAt)}</span>
      </div>
    </div>

    <div class="detail-section-title">Orders (${customer.orders ? customer.orders.length : 0})</div>
    ${ordersHTML}

    ${!customer.isAdmin ? `
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">
        <button class="btn btn-small admin-delete-btn" style="width:100%" onclick="deleteCustomer('${customer.id}', '${customer.username.replace(/'/g, "\\'")}')">
          🗑️ Delete This Account
        </button>
      </div>
    ` : ''}
  `;

  detail.style.display = '';
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── closeCustomerDetail() ─────────────────────────────────────
function closeCustomerDetail() {
  const detail = document.getElementById('customer-detail');
  if (detail) detail.style.display = 'none';
}


// ── loadAdminOrders() ─────────────────────────────────────────
async function loadAdminOrders() {
  const wrap = document.getElementById('orders-table-wrap');
  const badge = document.getElementById('order-count-badge');

  try {
    const res    = await fetch('/api/admin/orders', { credentials: 'include' });
    const orders = await res.json();

    // Update the tab badge count
    if (orders.length > 0) {
      badge.textContent    = orders.length;
      badge.style.display  = '';
    } else {
      badge.style.display  = 'none';
    }

    if (orders.length === 0) {
      wrap.innerHTML = '<p class="admin-empty">No orders yet.</p>';
      return;
    }

    // Sort newest first
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    wrap.innerHTML = `
      <table class="admin-table orders-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Customer</th>
            <th>Contact</th>
            <th>Address</th>
            <th>Items</th>
            <th>Total</th>
            <th>Screenshot</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td class="date-cell">${formatDate(o.createdAt)}</td>
              <td><strong>${o.customerName}</strong></td>
              <td>${o.contact}</td>
              <td class="address-cell">${o.address}</td>
              <td class="items-cell">
                ${o.items.map(i => `${i.name} ×${i.qty}`).join('<br/>')}
              </td>
              <td class="admin-price-cell">₱${parseFloat(o.total).toFixed(2)}</td>
              <td>
                <img
                  src="/${o.paymentScreenshot}"
                  alt="Payment"
                  class="payment-thumb"
                  onclick="viewScreenshot('/${o.paymentScreenshot}')"
                  title="Click to view full screenshot"
                />
              </td>
              <td>
                <select class="status-select status-${o.status}" onchange="updateOrderStatus('${o.id}', this)">
                  <option value="pending"   ${o.status === 'pending'   ? 'selected' : ''}>⏳ Pending</option>
                  <option value="confirmed" ${o.status === 'confirmed' ? 'selected' : ''}>✅ Confirmed</option>
                  <option value="shipped"   ${o.status === 'shipped'   ? 'selected' : ''}>🚚 Shipped</option>
                  <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>📬 Delivered</option>
                  <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>❌ Cancelled</option>
                </select>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch {
    wrap.innerHTML = '<p class="admin-empty">Could not load orders.</p>';
  }
}

// ── updateOrderStatus() ──────────────────────────────────────
async function updateOrderStatus(orderId, selectEl) {
  const status = selectEl.value;

  // Update the dropdown color to match status
  selectEl.className = `status-select status-${status}`;

  await fetch(`/api/admin/orders/${orderId}/status`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
}

// ── viewScreenshot() ─────────────────────────────────────────
// Opens the large screenshot viewer modal
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
// DISCOUNTS
// ════════════════════════════════════════════════════════════

async function loadAdminDiscounts() {
  const wrap = document.getElementById('discounts-table-wrap');
  if (!wrap) return;

  try {
    const res       = await fetch('/api/discounts', { credentials: 'include' });
    const discounts = await res.json();

    if (discounts.length === 0) {
      wrap.innerHTML = '<p class="admin-empty">No discounts yet. Click "Add Discount" to create one.</p>';
      return;
    }

    wrap.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Code / Name</th>
            <th>Type</th>
            <th>Value</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${discounts.map(d => `
            <tr>
              <td><strong class="code-style">${d.name}</strong></td>
              <td>${d.type === 'percent' ? '% Percent off' : '₱ Fixed amount'}</td>
              <td>${d.type === 'percent' ? d.value + '%' : '₱' + parseFloat(d.value).toFixed(2)}</td>
              <td class="admin-actions-cell">
                <button class="btn btn-small admin-edit-btn" onclick="openEditDiscountModal('${d.id}')">✏️ Edit</button>
                <button class="btn btn-small admin-delete-btn" onclick="deleteDiscount('${d.id}', '${d.name}')">🗑️ Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch {
    wrap.innerHTML = '<p class="admin-empty">Could not load discounts.</p>';
  }
}

function openDiscountModal() {
  document.getElementById('discount-modal-title').textContent = 'Add Discount';
  document.getElementById('discount-id').value    = '';
  document.getElementById('discount-name').value  = '';
  document.getElementById('discount-type').value  = 'percent';
  document.getElementById('discount-value').value = '';
  document.getElementById('discount-form-error').style.display = 'none';
  document.getElementById('discount-save-btn').textContent = 'Save Discount';
  document.getElementById('discount-modal').classList.add('open');
  document.getElementById('discount-modal-overlay').classList.add('open');
}

async function openEditDiscountModal(discountId) {
  const res       = await fetch('/api/discounts', { credentials: 'include' });
  const discounts = await res.json();
  const d         = discounts.find(x => x.id === discountId);
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

  errorBox.style.display = 'none';
  saveBtn.disabled       = true;
  saveBtn.textContent    = 'Saving...';

  const isEditing = !!id;
  const url    = isEditing ? `/api/admin/discounts/${id}` : '/api/admin/discounts';
  const method = isEditing ? 'PUT' : 'POST';

  try {
    const res  = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, value })
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent   = data.error || 'Something went wrong.';
      errorBox.style.display = '';
      saveBtn.disabled       = false;
      saveBtn.textContent    = isEditing ? 'Update Discount' : 'Save Discount';
      return;
    }

    closeDiscountModal();
    loadAdminDiscounts();

  } catch {
    errorBox.textContent   = 'Cannot connect to server.';
    errorBox.style.display = '';
    saveBtn.disabled       = false;
    saveBtn.textContent    = isEditing ? 'Update Discount' : 'Save Discount';
  }
}

async function deleteDiscount(id, name) {
  if (!confirm(`Delete discount "${name}"?`)) return;
  const res = await fetch(`/api/admin/discounts/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (res.ok) loadAdminDiscounts();
  else alert('Could not delete discount.');
}


// ════════════════════════════════════════════════════════════
// CUSTOMER DELETION
// ════════════════════════════════════════════════════════════

async function deleteCustomer(id, username) {
  if (!confirm(`Delete account for "${username}"? This cannot be undone.`)) return;

  const res = await fetch(`/api/admin/customers/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  if (res.ok) {
    closeCustomerDetail();
    loadAdminCustomers();
  } else {
    const data = await res.json();
    alert(data.error || 'Could not delete customer.');
  }
}


// ── formatDate() ─────────────────────────────────────────────
function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
