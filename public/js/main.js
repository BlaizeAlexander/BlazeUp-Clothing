// ============================================================
// main.js — Frontend JavaScript
// This file runs in the browser and connects your HTML pages
// to the backend server using fetch() requests.
//
// fetch() is like sending a letter to the server and waiting
// for a reply. The server processes it and sends back data.
// ============================================================


// ── Run on every page load ───────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  updateNavbar();
  updateCartBadge();
  setupLightboxInteractions();
  loadShippingFee();
  loadSocialLinks();

  if (window.location.pathname.includes('dashboard.html')) {
    loadDashboard();
  }

  // Shop page: require login before loading products
  if (window.location.pathname.includes('index.html') || window.location.pathname === '/') {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      if (!res.ok) {
        window.location.href = 'login.html';
        return;
      }
      loadProducts();
      loadDiscountsIntoCart();
    } catch {
      // Server not reachable — still show the page
      loadProducts();
    }
  }
});


// ── updateNavbar() ───────────────────────────────────────────
async function updateNavbar() {
  try {
    const response = await fetch('/api/me', { credentials: 'include' });

    if (response.ok) {
      const user = await response.json();
      showElement('nav-dashboard');
      showElement('nav-logout');
      hideElement('nav-login');
      hideElement('nav-register');

      // Admin link only visible to admin users
      if (user.isAdmin) {
        showElement('nav-admin');
      } else {
        hideElement('nav-admin');
      }

    } else {
      hideElement('nav-dashboard');
      hideElement('nav-logout');
      hideElement('nav-admin');
      showElement('nav-login');
      showElement('nav-register');
    }
  } catch (err) {
    console.log('Could not check login status');
  }
}

// ── loadProducts() ────────────────────────────────────────────
// Fetches products from /api/products and builds the product cards
async function loadProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  try {
    const res  = await fetch('/api/products');
    const products = await res.json();

    if (products.length === 0) {
      grid.innerHTML = '<p style="text-align:center;color:#777;padding:40px">No products yet. Check back soon!</p>';
      return;
    }

    grid.innerHTML = ''; // clear loading message
    grid.innerHTML = products.map(p => {
      const tiers     = p.priceTiers && p.priceTiers.length > 0 ? p.priceTiers : [];
      const tiersAttr = JSON.stringify(tiers).replace(/"/g, '&quot;');
      const images    = p.images && p.images.length > 0 ? p.images : [p.image];
      const variants  = p.variants && p.variants.length > 0 ? p.variants : [];
      const cid       = `c-${p.id}`;

      // Default price = first variant price (if any), else product base price
      const defaultPrice = variants.length > 0 ? variants[0].price : parseFloat(p.price);

      // Build a safe JS array literal for lightbox (paths are safe filenames)
      const lbArr = '[' + images.map(s => `'${s}'`).join(',') + ']';

      // Image section: carousel if multiple, plain img if single
      const imageHTML = images.length > 1
        ? `<div class="product-carousel" id="${cid}">
            <div class="carousel-main" onclick="carouselMainClick(event,'${cid}',${lbArr})">
              ${images.map((src, i) => `
                <img src="${src}" alt="${p.name.replace(/"/g, '&quot;')}"
                  class="carousel-img${i === 0 ? ' active' : ''}"
                  onerror="this.style.display='none'" />
              `).join('')}
              <button class="carousel-btn carousel-prev" type="button" onclick="event.stopPropagation();carouselStep('${cid}',-1)">&#8249;</button>
              <button class="carousel-btn carousel-next" type="button" onclick="event.stopPropagation();carouselStep('${cid}',1)">&#8250;</button>
              <div class="carousel-counter" id="${cid}-counter">1 / ${images.length}</div>
            </div>
            <div class="carousel-thumbs" id="${cid}-thumbs">
              ${images.map((src, i) => `
                <img src="${src}" alt=""
                  class="carousel-thumb${i === 0 ? ' active' : ''}"
                  onclick="carouselGo('${cid}',${i})"
                  onerror="this.style.display='none'" />
              `).join('')}
            </div>
          </div>`
        : `<div class="product-image" style="cursor:zoom-in" onclick="openLightbox(${lbArr},0)">
            <img src="${images[0]}" alt="${p.name.replace(/"/g, '&quot;')}"
              onerror="this.style.display='none'; this.parentElement.classList.add('no-image')" />
          </div>`;

      // Size/variant buttons
      const variantHTML = variants.length > 0
        ? `<div class="variant-selector" id="vs-${p.id}">
            ${variants.map((v, i) => `
              <button type="button"
                class="variant-btn${i === 0 ? ' active' : ''}"
                data-price="${v.price}"
                data-name="${v.name.replace(/"/g, '&quot;')}"
                onclick="selectVariant(this,'${p.id}')">
                ${v.name}
              </button>
            `).join('')}
          </div>`
        : '';

      const tierNote = tiers.length > 0
        ? `<div class="tier-note">${
            [...tiers].sort((a,b) => a.minQty - b.minQty)
              .map(t => `${t.minQty} pc${t.minQty > 1 ? 's' : ''}: ₱${parseFloat(t.price).toLocaleString('en-PH', {minimumFractionDigits:2})}`)
              .join(' &nbsp;·&nbsp; ')
          }</div>`
        : '';

      return `
        <div class="product-card">
          ${imageHTML}
          <div class="product-info">
            <h3>${p.name}</h3>
            <p class="product-desc">${p.description}</p>
            ${variantHTML}
            <div class="product-price-row">
              <span class="price" id="price-${p.id}">₱${defaultPrice.toFixed(2)}</span>
              ${tierNote}
            </div>
            <div class="product-add-row">
              ${p.stockQuantity === 0
                ? `<span class="out-of-stock-badge">Out of Stock</span>`
                : `<div class="card-qty-controls">
                <button class="card-qty-btn" type="button"
                  onclick="const i=this.nextElementSibling; i.value=Math.max(1,parseInt(i.value)-1); updateCardPrice('${p.id}',i)">−</button>
                <input type="number" class="card-qty-input" value="1" min="1" max="99"
                  oninput="updateCardPrice('${p.id}', this)" />
                <button class="card-qty-btn" type="button"
                  onclick="const i=this.previousElementSibling; i.value=Math.min(99,parseInt(i.value)+1); updateCardPrice('${p.id}',i)">+</button>
              </div>
              <button
                class="btn btn-small"
                data-name="${p.name.replace(/"/g, '&quot;')}"
                data-price="${defaultPrice}"
                data-image="${images[0].replace(/"/g, '&quot;')}"
                data-tiers="${tiersAttr}"
                data-pid="${p.id}"
                onclick="addToCartFromCard(this)"
              >Add to Cart</button>`
              }
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Set up touch/swipe for all carousels after DOM is rendered
    setupCarousels();

  } catch (err) {
    grid.innerHTML = '<p style="text-align:center;color:#777;padding:40px">Could not load products. Is the server running?</p>';
  }
}

// ── carouselMainClick() ──────────────────────────────────────
// Called when clicking the main image area — opens lightbox at current slide
function carouselMainClick(event, id, images) {
  // Ignore clicks on the prev/next buttons (they stopPropagation already, but just in case)
  if (event.target.classList.contains('carousel-btn') ||
      event.target.classList.contains('carousel-counter')) return;

  const c = document.getElementById(id);
  if (!c) return;
  let cur = 0;
  c.querySelectorAll('.carousel-img').forEach((img, i) => {
    if (img.classList.contains('active')) cur = i;
  });
  openLightbox(images, cur);
}

// ── setupCarousels() ──────────────────────────────────────────
// Adds touch/swipe support to all product carousels on the page
function setupCarousels() {
  document.querySelectorAll('.product-carousel').forEach(c => {
    const main = c.querySelector('.carousel-main');
    if (!main) return;
    let startX = 0;
    main.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
    }, { passive: true });
    main.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < 30) return; // ignore tiny taps
      carouselStep(c.id, dx < 0 ? 1 : -1);
    }, { passive: true });
  });
}


// ── registerUser() ───────────────────────────────────────────
// Called when the Register form is submitted
async function registerUser(event) {
  event.preventDefault(); // Stop the page from refreshing

  const errorBox = document.getElementById('error-message');
  const successBox = document.getElementById('success-message');
  const submitBtn = document.getElementById('submit-btn');

  // Get values from the form fields
  const username = document.getElementById('username').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const referralCode = document.getElementById('referralCode').value.trim();
  const contactEl = document.getElementById('contact');
  const contact = contactEl ? contactEl.value.trim() : '';

  // Simple client-side validation
  if (password.length < 6) {
    showError(errorBox, 'Password must be at least 6 characters.');
    return;
  }

  // Disable button and show loading state while waiting for server
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating account...';
  hideElement('error-message');
  hideElement('success-message');

  try {
    // Send registration data to the server
    // fetch() makes an HTTP request — like clicking a link but in the background
    const response = await fetch('/api/register', {
      method: 'POST',                         // POST = sending data
      headers: { 'Content-Type': 'application/json' }, // Tell server we're sending JSON
      credentials: 'include',                 // Include session cookies
      body: JSON.stringify({                  // Convert JS object to JSON string
        username,
        email,
        password,
        referralCode,
        contact
      })
    });

    // Parse the server's response (it sends back JSON)
    const data = await response.json();

    if (response.ok) {
      successBox.textContent = 'Registration received! Awaiting approval. If you don\'t hear back soon, please contact us directly.';
      showElement('success-message');
      document.getElementById('register-form').style.display = 'none';
    } else {
      // Server returned an error (e.g., email already exists)
      showError(errorBox, data.error || 'Something went wrong. Please try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
    }

  } catch (err) {
    // Network error (server not running, etc.)
    showError(errorBox, 'Cannot connect to server. Is it running?');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Account';
  }
}


// ── loginUser() ──────────────────────────────────────────────
// Called when the Login form is submitted
async function loginUser(event) {
  event.preventDefault();

  const errorBox = document.getElementById('error-message');
  const submitBtn = document.getElementById('submit-btn');

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in...';
  hideElement('error-message');

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (response.ok) {
      // Login successful — go to dashboard
      window.location.href = 'dashboard.html';
    } else {
      showError(errorBox, data.error || 'Invalid email or password.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log In';
    }

  } catch (err) {
    showError(errorBox, 'Cannot connect to server. Is it running?');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log In';
  }
}


// ── logout() ─────────────────────────────────────────────────
// Called when the Logout link is clicked
async function logout() {
  try {
    await fetch('/api/logout', {
      method: 'POST',
      credentials: 'include'
    });
  } catch (err) {
    // Even if there's an error, redirect to home
  }
  window.location.href = 'index.html';
}


// ── loadDashboard() ──────────────────────────────────────────
// Called on dashboard.html — fetches user data and fills the page
async function loadDashboard() {
  try {
    const response = await fetch('/api/me', {
      credentials: 'include'
    });

    if (!response.ok) {
      // Not logged in — redirect to login page
      window.location.href = 'login.html';
      return;
    }

    // Get the user data object from the server
    const user = await response.json();

    // Fill in all the placeholder elements with real data
    document.getElementById('user-username').textContent      = user.username;
    document.getElementById('user-referral-code').textContent = user.referralCode;
    document.getElementById('user-referral-count').textContent = user.referralCount;
    document.getElementById('user-created-at').textContent    = formatDate(user.createdAt);
    document.getElementById('user-points').textContent        = user.points || 0;

    // Account info section
    document.getElementById('info-username').textContent  = user.username;
    document.getElementById('info-email').textContent     = user.email;
    document.getElementById('info-contact').textContent   = user.contact || 'Not set';
    document.getElementById('info-referred-by').textContent = user.referredBy || 'Nobody (direct signup)';

    // Set avatar
    const avatarImg      = document.getElementById('user-avatar-img');
    const avatarInitials = document.getElementById('user-avatar-initials');
    if (user.avatarUrl) {
      avatarImg.src           = user.avatarUrl;
      avatarImg.style.display = '';
      avatarImg.style.cursor  = 'zoom-in';
      avatarImg.onclick       = () => openImageModal(user.avatarUrl);
      avatarInitials.style.display = 'none';
    } else {
      avatarInitials.textContent   = (user.username || '?')[0].toUpperCase();
      avatarInitials.style.display = '';
      avatarImg.style.display      = 'none';
    }

    // Pre-fill edit form with current values
    const editUsername = document.getElementById('edit-username');
    const editContact  = document.getElementById('edit-contact');
    if (editUsername) editUsername.value = user.username || '';
    if (editContact)  editContact.value  = user.contact  || '';

    // Build the shareable referral link
    // http://localhost:3000/register.html?ref=ABC123
    const referralLink = `${window.location.origin}/register.html?ref=${user.referralCode}`;
    document.getElementById('referral-link').value = referralLink;

    // Hide the loading spinner and show the content
    hideElement('loading');
    showElement('dashboard-content');

    // Load order history
    loadMyOrders();

  } catch (err) {
    window.location.href = 'login.html';
  }
}


// ── updateProfile() ──────────────────────────────────────────
// Saves updated contact number and delivery address
// ── toggleProfileEdit() ──────────────────────────────────────
function toggleProfileEdit() {
  const view    = document.getElementById('profile-view');
  const form    = document.getElementById('profile-form');
  const btn     = document.getElementById('edit-profile-btn');
  const isEditing = form.style.display !== 'none';

  if (isEditing) {
    // Cancel — go back to view mode
    form.style.display = 'none';
    view.style.display = '';
    btn.textContent = '✏️ Edit Profile';
    document.getElementById('profile-success').style.display = 'none';
    document.getElementById('profile-error').style.display   = 'none';
  } else {
    // Enter edit mode
    view.style.display = 'none';
    form.style.display = '';
    btn.textContent = '✕ Cancel';
  }
}

async function updateProfile(event) {
  event.preventDefault();

  const username   = document.getElementById('edit-username').value.trim();
  const contact    = document.getElementById('edit-contact').value.trim();
  const successBox = document.getElementById('profile-success');
  const errorBox   = document.getElementById('profile-error');
  const saveBtn    = document.getElementById('profile-save-btn');

  saveBtn.disabled    = true;
  saveBtn.textContent = 'Saving...';
  successBox.style.display = 'none';
  errorBox.style.display   = 'none';

  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, contact })
    });

    if (res.ok) {
      // Update displayed values and go back to view mode
      document.getElementById('info-username').textContent = username || '---';
      document.getElementById('info-contact').textContent  = contact  || 'Not set';
      document.getElementById('user-username').textContent = username || '---';
      // Collapse form back to view mode
      document.getElementById('profile-form').style.display = 'none';
      document.getElementById('profile-view').style.display = '';
      document.getElementById('edit-profile-btn').textContent = '✏️ Edit Profile';
      successBox.style.display = '';
      // Show success briefly in the view section
      document.getElementById('profile-view').appendChild(successBox);
      setTimeout(() => successBox.style.display = 'none', 3000);
    } else {
      const data = await res.json();
      errorBox.textContent   = data.error || 'Could not save. Please try again.';
      errorBox.style.display = '';
    }
  } catch {
    errorBox.textContent   = 'Cannot connect to server.';
    errorBox.style.display = '';
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save Changes';
  }
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

// ── Avatar upload (preview → save) ───────────────────────────
function previewAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  const preview = document.getElementById('avatar-preview');
  const wrap    = document.getElementById('avatar-save-wrap');
  preview.src = URL.createObjectURL(file);
  wrap.style.display = 'flex';
}

function cancelAvatarPreview() {
  const input   = document.getElementById('avatar-file-input');
  const preview = document.getElementById('avatar-preview');
  const wrap    = document.getElementById('avatar-save-wrap');
  input.value     = '';
  preview.src     = '';
  wrap.style.display = 'none';
}

async function saveAvatar() {
  const input = document.getElementById('avatar-file-input');
  const file  = input.files[0];
  if (!file) return;

  const saveBtn = document.querySelector('#avatar-save-wrap .btn-primary');
  if (saveBtn) saveBtn.textContent = '⏳ Saving…';

  const formData = new FormData();
  formData.append('avatar', file);

  try {
    const res  = await fetch('/api/profile/avatar', { method: 'POST', credentials: 'include', body: formData });
    const data = await res.json();
    if (res.ok) {
      const img      = document.getElementById('user-avatar-img');
      const initials = document.getElementById('user-avatar-initials');
      img.src              = data.avatarUrl;
      img.style.display    = '';
      initials.style.display = 'none';
      cancelAvatarPreview();
    } else {
      alert(data.error || 'Could not upload photo.');
    }
  } catch {
    alert('Cannot connect to server.');
  } finally {
    if (saveBtn) saveBtn.textContent = 'Save Photo';
  }
}

// ── loadMyOrders() ────────────────────────────────────────────
// Fetches and displays the logged-in user's order history
async function loadMyOrders() {
  const loadingEl = document.getElementById('orders-loading');
  const listEl    = document.getElementById('orders-list');
  if (!loadingEl || !listEl) return;

  try {
    const res    = await fetch('/api/orders/my', { credentials: 'include' });
    const orders = await res.json();

    loadingEl.style.display = 'none';
    listEl.style.display    = '';

    if (!orders.length) {
      listEl.innerHTML = `
        <div style="color:var(--text-light);font-size:0.9rem;padding:16px 0">
          No orders yet. <a href="index.html" style="color:var(--accent);font-weight:600">Start shopping!</a>
        </div>`;
      return;
    }

    listEl.innerHTML = orders.map(o => `
      <div class="order-history-card">
        <div class="order-history-header">
          <span class="order-history-id">Order #${o.id.replace('ord_','')}</span>
          <span class="order-status-badge status-badge-${o.status}">${statusLabel(o.status)}</span>
          <span class="order-history-date">${formatDate(o.createdAt)}</span>
        </div>
        <div class="order-history-items">
          ${(o.items || []).map(i => `<span>${i.name} ×${i.qty}</span>`).join(' · ')}
        </div>
        <div class="order-history-total">Total: <strong>₱${parseFloat(o.total).toFixed(2)}</strong></div>
        <div class="order-history-address">📍 ${o.address}</div>
      </div>
    `).join('');

  } catch {
    if (loadingEl) loadingEl.textContent = 'Could not load order history.';
  }
}

// Maps status string to a user-friendly label
function statusLabel(status) {
  const map = {
    pending:   '⏳ Pending',
    confirmed: '✅ Confirmed',
    shipped:   '🚚 Shipped',
    delivered: '📬 Delivered',
    cancelled: '❌ Cancelled'
  };
  return map[status] || status;
}


// ── copyCode() ───────────────────────────────────────────────
// Copies the referral code to clipboard
function copyCode() {
  const code = document.getElementById('user-referral-code').textContent;
  copyToClipboard(code);
}

// ── copyLink() ───────────────────────────────────────────────
// Copies the full referral link to clipboard
function copyLink() {
  const link = document.getElementById('referral-link').value;
  copyToClipboard(link);
}

// ── copyToClipboard() ────────────────────────────────────────
// Shared helper that copies text and shows feedback
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    const feedback = document.getElementById('copy-feedback');
    if (feedback) {
      showElement('copy-feedback');
      // Hide feedback after 2 seconds
      setTimeout(() => hideElement('copy-feedback'), 2000);
    }
  });
}


// ============================================================
// CART SYSTEM
// The cart is stored in localStorage — a mini database built
// into the browser. It remembers items even after page refresh.
//
// Cart format:
// [
//   { name: "Product 1", price: 29.99, image: "assets/p1.jpg", qty: 2 },
//   { name: "Product 2", price: 49.99, image: "assets/p2.jpg", qty: 1 }
// ]
// ============================================================

// ── getCart() ────────────────────────────────────────────────
// Read the cart from localStorage. Returns an array.
function getCart() {
  return JSON.parse(localStorage.getItem('cart') || '[]');
}

// ── saveCart() ───────────────────────────────────────────────
// Save the cart array back to localStorage
function saveCart(cart) {
  localStorage.setItem('cart', JSON.stringify(cart));
}

// ── getTierPrice() ───────────────────────────────────────────
// Returns the effective price per item based on quantity and tiers.
// Returns null if no tiers or no tier applies (use base price).
function getTierPrice(tiers, qty) {
  if (!tiers || tiers.length === 0) return null;
  // Sort descending so we find the highest matching tier first
  const sorted = [...tiers].sort((a, b) => b.minQty - a.minQty);
  for (const tier of sorted) {
    if (qty >= tier.minQty) return tier.price;
  }
  return null;
}

// ── updateCardPrice() ────────────────────────────────────────
// Called oninput on the qty field. Updates the displayed price
// to the correct tier price for the entered quantity.
function updateCardPrice(pid, inputEl) {
  const qty    = Math.max(1, parseInt(inputEl.value) || 1);
  const card   = inputEl.closest('.product-card');
  const addBtn = card ? card.querySelector('[data-pid]') : null;
  if (!addBtn) return;

  const basePrice = parseFloat(addBtn.dataset.price);
  const tiers     = addBtn.dataset.tiers ? JSON.parse(addBtn.dataset.tiers) : [];
  const tierPrice = getTierPrice(tiers, qty);
  const effPrice  = tierPrice !== null ? tierPrice : basePrice;

  const priceEl = document.getElementById(`price-${pid}`);
  if (priceEl) priceEl.textContent = '₱' + effPrice.toFixed(2);
}

// ── selectVariant() ──────────────────────────────────────────
// Called when a size/variant button is clicked on a product card.
function selectVariant(clickedBtn, productId) {
  // Highlight selected button
  const selector = document.getElementById(`vs-${productId}`);
  if (selector) {
    selector.querySelectorAll('.variant-btn').forEach(b => b.classList.remove('active'));
  }
  clickedBtn.classList.add('active');

  // Update the price display
  const priceEl = document.getElementById(`price-${productId}`);
  if (priceEl) priceEl.textContent = '₱' + parseFloat(clickedBtn.dataset.price).toFixed(2);

  // Update the Add to Cart button's price and variant data-name
  const card   = clickedBtn.closest('.product-card');
  const addBtn = card ? card.querySelector('[data-pid]') : null;
  if (addBtn) {
    addBtn.dataset.price       = clickedBtn.dataset.price;
    addBtn.dataset.variantName = clickedBtn.dataset.name;
    // Re-apply tier pricing for current qty after variant change
    const card  = addBtn.closest('.product-card');
    const input = card ? card.querySelector('.card-qty-input') : null;
    if (input) updateCardPrice(productId, input);
  }
}

// ── carouselStep() ───────────────────────────────────────────
function carouselStep(id, delta) {
  const c = document.getElementById(id);
  if (!c) return;
  const imgs = c.querySelectorAll('.carousel-img');
  let cur = 0;
  imgs.forEach((img, i) => { if (img.classList.contains('active')) cur = i; });
  carouselGo(id, (cur + delta + imgs.length) % imgs.length);
}

// ── carouselGo() ─────────────────────────────────────────────
function carouselGo(id, index) {
  const c = document.getElementById(id);
  if (!c) return;
  // Update main images
  c.querySelectorAll('.carousel-img').forEach((img, i) => img.classList.toggle('active', i === index));
  // Update thumbnails
  const thumbWrap = document.getElementById(`${id}-thumbs`);
  if (thumbWrap) {
    const thumbs = thumbWrap.querySelectorAll('.carousel-thumb');
    thumbs.forEach((t, i) => t.classList.toggle('active', i === index));
    // Scroll active thumb into view smoothly
    if (thumbs[index]) thumbs[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  // Update counter
  const counter = document.getElementById(`${id}-counter`);
  if (counter) {
    const total = c.querySelectorAll('.carousel-img').length;
    counter.textContent = `${index + 1} / ${total}`;
  }
}

// ── addToCartFromCard() ──────────────────────────────────────
// Called by the "Add to Cart" button on a product card.
// Reads the qty and selected variant from the card.
function addToCartFromCard(btn) {
  const row   = btn.closest('.product-add-row');
  const input = row ? row.querySelector('.card-qty-input') : null;
  const qty   = input ? Math.max(1, parseInt(input.value) || 1) : 1;

  // If a variant is selected, append its name to the product name so
  // the cart distinguishes between e.g. "Kush — Small" and "Kush — Large"
  const variantName = btn.dataset.variantName;
  const displayName = variantName ? `${btn.dataset.name} — ${variantName}` : btn.dataset.name;

  addToCart(displayName, parseFloat(btn.dataset.price), btn.dataset.image, btn, btn.dataset.tiers, qty, btn.dataset.pid);
}

// ── addToCart() ──────────────────────────────────────────────
// name, price, image — product details
// btn       — the button element (flash feedback)
// tiersJSON — JSON string of price tiers
// qty       — how many to add (default 1)
function addToCart(name, price, image, btn, tiersJSON, qty, productId) {
  qty = qty || 1;
  const cart  = getCart();
  const tiers = tiersJSON ? JSON.parse(tiersJSON) : [];

  const existing = cart.find(item => item.name === name);

  if (existing) {
    existing.qty   += qty;
    existing.tiers  = tiers;
    const tierPrice = getTierPrice(tiers, existing.qty);
    existing.price  = tierPrice !== null ? tierPrice : existing.basePrice;
  } else {
    const basePrice = price;
    const tierPrice = getTierPrice(tiers, qty);
    const effPrice  = tierPrice !== null ? tierPrice : basePrice;
    // productId stored so server can track COGS and decrement stock accurately
    cart.push({ name, basePrice, price: effPrice, image, qty, tiers, productId: productId || null });
  }

  saveCart(cart);
  updateCartBadge();

  // Flash the button text to give visual feedback
  if (btn) {
    const original = btn.textContent;
    btn.textContent = 'Added!';
    btn.style.background = '#28a745'; // Turn green briefly
    setTimeout(() => {
      btn.textContent = original;
      btn.style.background = '';
    }, 1000); // Reset after 1 second
  }
}

// ── removeFromCart() ─────────────────────────────────────────
// Remove an item completely from the cart (the ✕ button)
function removeFromCart(index) {
  const cart = getCart();
  cart.splice(index, 1); // Remove 1 item at position "index"
  saveCart(cart);
  renderCart();
  updateCartBadge();
}

// ── changeQty() ───────────────────────────────────────────────
// delta = +1 (add one more) or -1 (take one away)
function changeQty(index, delta) {
  const cart = getCart();
  cart[index].qty += delta;

  if (cart[index].qty <= 0) {
    cart.splice(index, 1);
  } else {
    // Recalculate tier price for new quantity
    const tiers     = cart[index].tiers || [];
    const tierPrice = getTierPrice(tiers, cart[index].qty);
    cart[index].price = tierPrice !== null ? tierPrice : (cart[index].basePrice || cart[index].price);
  }

  saveCart(cart);
  renderCart();
  updateCartBadge();
}

// ── updateCartBadge() ────────────────────────────────────────
// Update the little number bubble on the cart icon in the navbar
function updateCartBadge() {
  const cart = getCart();
  const badge = document.getElementById('cart-badge');
  if (!badge) return; // Badge might not exist on all pages

  // Add up all quantities (e.g. 2 items + 1 item = badge shows 3)
  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);

  if (totalItems > 0) {
    badge.textContent = totalItems;
    badge.style.display = '';   // Show the badge
  } else {
    badge.style.display = 'none'; // Hide it when cart is empty
  }
}

// ── renderCart() ─────────────────────────────────────────────
function renderCart() {
  const cart      = getCart();
  const container = document.getElementById('cart-items');
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty">
        <p>Your cart is empty.</p>
        <p>Add some items to get started!</p>
      </div>
    `;
    updateCartTotals(0);
    return;
  }

  let html     = '';
  let subtotal = 0;

  cart.forEach((item, index) => {
    // Ensure price is always a valid number, handling old/corrupt cart data
    const price      = parseFloat(item.price) || parseFloat(item.basePrice) || 0;
    const qty        = parseInt(item.qty) || 1;
    const lineTotal  = price * qty;
    subtotal        += lineTotal;
    const isTierPrice = item.basePrice && price !== parseFloat(item.basePrice);

    html += `
      <div class="cart-item">
        <img
          src="${item.image || ''}"
          alt="${item.name || ''}"
          class="cart-item-img"
          onerror="this.style.display='none'"
        />
        <div class="cart-item-details">
          <p class="cart-item-name">${item.name || 'Item'}</p>
          <p class="cart-item-price">
            ₱${price.toFixed(2)} each
            ${isTierPrice ? `<span class="tier-badge">Bulk price</span>` : ''}
          </p>
          <div class="qty-controls">
            <button class="qty-btn" onclick="changeQty(${index}, -1)">−</button>
            <span class="qty-num">${qty}</span>
            <button class="qty-btn" onclick="changeQty(${index}, +1)">+</button>
          </div>
          <p class="cart-item-line">= ₱${lineTotal.toFixed(2)}</p>
        </div>
        <button class="cart-remove-btn" onclick="removeFromCart(${index})">✕</button>
      </div>
    `;
  });

  container.innerHTML = html;
  updateCartTotals(subtotal);
}

// ── Points state ─────────────────────────────────────────────
let _userPoints = 0;

// ── Shipping fee state ───────────────────────────────────────
let _shippingFee = 0;

async function loadShippingFee() {
  try {
    const res = await fetch('/api/shipping-fee');
    if (res.ok) {
      const data = await res.json();
      _shippingFee = data.shippingFee || 0;
    }
  } catch { /* non-critical, default to 0 */ }
}


async function loadSocialLinks() {
  try {
    const res = await fetch('/api/social-links');
    if (!res.ok) return;
    const { facebookUrl, instagramUrl, telegramUrl } = await res.json();
    const map = { 'social-facebook': facebookUrl, 'social-instagram': instagramUrl, 'social-telegram': telegramUrl };
    Object.entries(map).forEach(([id, url]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (url) { el.href = url; el.style.display = ''; }
      else { el.style.display = 'none'; }
    });
  } catch { /* non-critical */ }
}

function getPointsDiscount(subtotal, discountAmt) {
  const toggle = document.getElementById('cart-points-toggle');
  if (!toggle || !toggle.checked || !_userPoints) return 0;
  const afterDiscount = Math.max(0, subtotal - discountAmt);
  return Math.min(_userPoints, afterDiscount); // 1pt = ₱1, capped at remaining total
}

// ── updateCartTotals() ───────────────────────────────────────
function updateCartTotals(subtotal) {
  const subtotalEl      = document.getElementById('cart-subtotal');
  const totalEl         = document.getElementById('cart-total');
  const discountLine    = document.getElementById('cart-discount-line');
  const discountAmtEl   = document.getElementById('cart-discount-amount');
  const pointsLine      = document.getElementById('cart-points-line');
  const pointsDiscEl    = document.getElementById('cart-points-discount');

  if (subtotalEl) subtotalEl.textContent = '₱' + subtotal.toFixed(2);

  const discount    = getSelectedDiscount();
  const discountAmt = calcDiscountAmount(subtotal, discount);

  if (discountLine && discountAmtEl) {
    if (discountAmt > 0) {
      discountAmtEl.textContent   = '-₱' + discountAmt.toFixed(2);
      discountLine.style.display  = '';
    } else {
      discountLine.style.display = 'none';
    }
  }

  const pointsAmt = getPointsDiscount(subtotal, discountAmt);
  if (pointsLine && pointsDiscEl) {
    if (pointsAmt > 0) {
      pointsDiscEl.textContent  = '-₱' + pointsAmt.toFixed(2);
      pointsLine.style.display  = '';
    } else {
      pointsLine.style.display = 'none';
    }
  }

  const shippingLine = document.getElementById('cart-shipping-line');
  const shippingEl   = document.getElementById('cart-shipping-fee');
  if (shippingLine && shippingEl) {
    if (_shippingFee > 0) {
      shippingEl.textContent  = '₱' + _shippingFee.toFixed(2);
      shippingLine.style.display = '';
    } else {
      shippingLine.style.display = 'none';
    }
  }

  const total = Math.max(0, subtotal - discountAmt - pointsAmt) + _shippingFee;
  if (totalEl) totalEl.textContent = '₱' + total.toFixed(2);
}

// ── togglePoints() ───────────────────────────────────────────
function togglePoints() {
  const cart     = getCart();
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  updateCartTotals(subtotal);
}

// ── loadDiscountsIntoCart() ───────────────────────────────────
async function loadDiscountsIntoCart() {
  try {
    const res       = await fetch('/api/discounts', { credentials: 'include' });
    const discounts = await res.json();
    const select    = document.getElementById('cart-discount-select');
    const row       = document.getElementById('cart-discount-row');
    if (!select || !row) return;

    // Clear old options (keep "No discount" first)
    select.innerHTML = '<option value="">No discount</option>';
    discounts.forEach(d => {
      const label = d.type === 'percent'
        ? `${d.name} (${d.value}% off)`
        : `${d.name} (₱${parseFloat(d.value).toFixed(2)} off)`;
      const opt = document.createElement('option');
      opt.value       = JSON.stringify(d);
      opt.textContent = label;
      select.appendChild(opt);
    });

    row.style.display = discounts.length > 0 ? '' : 'none';
  } catch {
    // No discounts available
  }
}

// ── getSelectedDiscount() ────────────────────────────────────
function getSelectedDiscount() {
  const select = document.getElementById('cart-discount-select');
  if (!select || !select.value) return null;
  try { return JSON.parse(select.value); } catch { return null; }
}

// ── calcDiscountAmount() ─────────────────────────────────────
function calcDiscountAmount(subtotal, discount) {
  if (!discount) return 0;
  if (discount.type === 'percent') return subtotal * (discount.value / 100);
  if (discount.type === 'fixed')   return Math.min(discount.value, subtotal);
  return 0;
}

// ── applyDiscount() ──────────────────────────────────────────
// Called when the discount dropdown changes
function applyDiscount() {
  const cart     = getCart();
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  updateCartTotals(subtotal);
}

// ── purgeOutOfStockFromCart() ────────────────────────────────
// Fetches live stock, silently removes any cart items whose product
// is now out of stock. Returns array of removed item names.
async function purgeOutOfStockFromCart() {
  try {
    const res = await fetch('/api/products', { credentials: 'include' });
    if (!res.ok) return [];
    const products = await res.json();
    const outOfStock = new Set(products.filter(p => p.stockQuantity === 0).map(p => p.id));

    const cart    = getCart();
    const removed = cart.filter(item => item.productId && outOfStock.has(item.productId)).map(i => i.name);
    const updated = cart.filter(item => !item.productId || !outOfStock.has(item.productId));

    if (removed.length) {
      saveCart(updated);
      updateCartBadge();
    }
    return removed;
  } catch {
    return [];
  }
}

// ── openCart() ───────────────────────────────────────────────
async function openCart() {
  document.getElementById('cart-sidebar').classList.add('open');
  document.getElementById('cart-overlay').classList.add('open');

  const removed = await purgeOutOfStockFromCart();
  const notice  = document.getElementById('cart-stock-notice');
  if (notice) {
    if (removed.length) {
      notice.textContent   = `Removed out-of-stock item${removed.length > 1 ? 's' : ''}: ${removed.join(', ')}`;
      notice.style.display = '';
    } else {
      notice.style.display = 'none';
    }
  }

  try { renderCart(); } catch(e) { console.error(e); }

  // Load user points if logged in
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (res.ok) {
      const me = await res.json();
      _userPoints = me.points || 0;
      const row       = document.getElementById('cart-points-row');
      const available = document.getElementById('cart-points-available');
      const valLabel  = document.getElementById('cart-points-value-label');
      if (row && _userPoints > 0) {
        available.textContent = _userPoints;
        valLabel.textContent  = `(= ₱${_userPoints.toFixed(2)} off)`;
        row.style.display = '';
      } else if (row) {
        row.style.display = 'none';
      }
    }
  } catch { /* not logged in, no points row */ }
}

// ── closeCart() ──────────────────────────────────────────────
// Slide out the cart sidebar
function closeCart() {
  document.getElementById('cart-sidebar').classList.remove('open');
  document.getElementById('cart-overlay').classList.remove('open');
}

// ── checkout() ───────────────────────────────────────────────
// Called when the "Checkout" button in the cart sidebar is clicked
function checkout() {
  const cart = getCart();
  if (cart.length === 0) {
    alert('Your cart is empty!');
    return;
  }
  closeCart();            // Close the cart sidebar first
  openCheckoutModal();    // Then open the checkout form
}

// ── openCheckoutModal() ──────────────────────────────────────
async function openCheckoutModal() {
  const cart     = getCart();
  const summaryEl = document.getElementById('checkout-summary');
  const discount  = getSelectedDiscount();

  let summaryHTML = '<div class="checkout-summary"><h3>Order Summary</h3>';
  let subtotal    = 0;

  cart.forEach(item => {
    const lineTotal = item.price * item.qty;
    subtotal       += lineTotal;
    summaryHTML    += `
      <div class="summary-row">
        <span>${item.name} × ${item.qty}</span>
        <span>₱${lineTotal.toFixed(2)}</span>
      </div>
    `;
  });

  const discountAmt = calcDiscountAmount(subtotal, discount);
  const pointsAmt   = getPointsDiscount(subtotal, discountAmt);
  const total       = Math.max(0, subtotal - discountAmt - pointsAmt) + _shippingFee;

  if (discountAmt > 0) {
    summaryHTML += `
      <div class="summary-row" style="color:var(--success)">
        <span>Discount (${discount.name})</span>
        <span>-₱${discountAmt.toFixed(2)}</span>
      </div>
    `;
  }
  if (pointsAmt > 0) {
    summaryHTML += `
      <div class="summary-row" style="color:var(--success)">
        <span>⭐ Points used (${pointsAmt} pts)</span>
        <span>-₱${pointsAmt.toFixed(2)}</span>
      </div>
    `;
  }
  if (_shippingFee > 0) {
    summaryHTML += `
      <div class="summary-row">
        <span>Shipping</span>
        <span>₱${_shippingFee.toFixed(2)}</span>
      </div>
    `;
  }

  summaryHTML += `
    <div class="summary-row summary-total">
      <span>Total</span>
      <span>₱${total.toFixed(2)}</span>
    </div>
  </div>`;

  summaryEl.innerHTML = summaryHTML;

  // Clear previous form inputs, pre-filling contact/address from profile if available
  document.getElementById('order-name').value    = '';
  document.getElementById('order-contact').value = '';
  document.getElementById('order-address').value = '';

  // Try to auto-fill contact and address from user's saved profile
  try {
    const meRes = await fetch('/api/me', { credentials: 'include' });
    if (meRes.ok) {
      const me = await meRes.json();
      if (me.contact)        document.getElementById('order-contact').value = me.contact;
      if (me.pinnedLocation) document.getElementById('order-address').value  = me.pinnedLocation;
    }
  } catch { /* silently ignore — fields stay empty */ }

  // Load payment QR code from settings
  try {
    const qrRes = await fetch('/api/payment-qr');
    if (qrRes.ok) {
      const qrData = await qrRes.json();
      const qrWrap = document.getElementById('payment-qr-wrap');
      const qrImg  = document.getElementById('payment-qr-img');
      if (qrData.path && qrWrap && qrImg) {
        qrImg.src = qrData.path;
        qrWrap.style.display = '';
        const dlBtn = document.getElementById('payment-qr-download');
        if (dlBtn) dlBtn.href = qrData.path;
      }
    }
  } catch { /* no QR configured */ }

  // Make sure the form is visible and confirmation is hidden
  document.getElementById('checkout-form').style.display = '';
  document.getElementById('order-confirmation').style.display = 'none';

  // Show the modal and overlay
  document.getElementById('checkout-modal').classList.add('open');
  document.getElementById('checkout-overlay').classList.add('open');
}

// ── closeCheckoutModal() ─────────────────────────────────────
// Hides the checkout modal
function closeCheckoutModal() {
  document.getElementById('checkout-modal').classList.remove('open');
  document.getElementById('checkout-overlay').classList.remove('open');
}

// ── previewScreenshot() ──────────────────────────────────────
// Shows a thumbnail of the chosen screenshot file
function previewScreenshot(input) {
  const file = input.files[0];
  if (!file) return;

  const preview  = document.getElementById('screenshot-preview');
  const label    = document.getElementById('file-upload-text');
  const reader   = new FileReader();

  reader.onload = (e) => {
    preview.src          = e.target.result;
    preview.style.display = '';          // Show the thumbnail
    label.style.display   = 'none';      // Hide the "tap to upload" text
  };
  reader.readAsDataURL(file);
}

// ── submitOrder() ────────────────────────────────────────────
// Called when the customer clicks "Confirm Order"
// Uses FormData so we can send the screenshot image file
async function submitOrder(event) {
  event.preventDefault();

  const name       = document.getElementById('order-name').value.trim();
  const contact    = document.getElementById('order-contact').value.trim();
  const address    = document.getElementById('order-address').value.trim();
  const screenshot = document.getElementById('order-screenshot').files[0];
  const cart       = getCart();
  const errorBox   = document.getElementById('checkout-error');
  const submitBtn  = document.getElementById('confirm-order-btn');

  if (!screenshot) {
    errorBox.textContent = 'Please upload your GCash payment screenshot.';
    errorBox.style.display = '';
    return;
  }

  const subtotal    = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const discount    = getSelectedDiscount();
  const discountAmt = calcDiscountAmount(subtotal, discount);
  const pointsAmt   = getPointsDiscount(subtotal, discountAmt);
  const total       = Math.max(0, subtotal - discountAmt - pointsAmt) + _shippingFee;

  // Disable button while uploading
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Sending order...';
  errorBox.style.display = 'none';

  // Build FormData — this lets us send both text fields AND a file
  const formData = new FormData();
  formData.append('customerName', name);
  formData.append('contact',      contact);
  formData.append('address',      address);
  formData.append('items',        JSON.stringify(cart));
  formData.append('total',        total);
  formData.append('pointsUsed',   pointsAmt);
  formData.append('screenshot',   screenshot);

  try {
    const res  = await fetch('/api/orders', {
      method: 'POST',
      credentials: 'include',
      body: formData
      // NOTE: Do NOT set Content-Type header — browser does it automatically for FormData
    });

    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent   = data.error || 'Something went wrong. Please try again.';
      errorBox.style.display = '';
      submitBtn.disabled    = false;
      submitBtn.textContent  = 'Confirm Order';
      return;
    }

    // Success — show confirmation message
    document.getElementById('checkout-form').style.display = 'none';

    const confirmEl = document.getElementById('order-confirmation');
    confirmEl.innerHTML = `
      <div class="confirm-icon">✅</div>
      <h3>Order Confirmed!</h3>
      <p>Thank you, <strong>${name}</strong>!</p>
      <div class="confirm-details">
        <p>📞 <strong>Contact:</strong> ${contact}</p>
        <p>📍 <strong>Address:</strong> ${address}</p>
        <p>💰 <strong>Total:</strong> ₱${total.toFixed(2)}</p>
      </div>
      <div class="gcash-confirm-box">
        <p>💚 <strong>Payment received!</strong></p>
        <p>We have received your payment screenshot.<br/>
        We will contact you at <strong>${contact}</strong> to confirm your delivery.</p>
      </div>
      <button class="btn btn-primary btn-full" onclick="closeCheckoutModal()" style="margin-top:16px">
        Done
      </button>
    `;
    confirmEl.style.display = '';

    // Clear the cart and reset points toggle
    localStorage.removeItem('cart');
    updateCartBadge();
    _userPoints = 0;
    const toggle = document.getElementById('cart-points-toggle');
    if (toggle) toggle.checked = false;
    const prow = document.getElementById('cart-points-row');
    if (prow) prow.style.display = 'none';

  } catch (err) {
    errorBox.textContent   = 'Cannot connect to server. Is it running?';
    errorBox.style.display = '';
    submitBtn.disabled    = false;
    submitBtn.textContent  = 'Confirm Order';
  }
}


// ============================================================
// LIGHTBOX — Full-screen image viewer with zoom & swipe
// ============================================================

let _lbImages    = [];
let _lbIndex     = 0;
let _lbScale     = 1;
let _lbPinchDist = 0;
let _lbLastTap   = 0;
let _lbSwipeX    = 0;

// ── openLightbox() ───────────────────────────────────────────
// images: array of src strings, index: which one to show first
function openLightbox(images, index) {
  _lbImages = Array.isArray(images) ? images : [images];
  _lbIndex  = index || 0;
  _lbScale  = 1;
  _renderLightbox();
  const lb = document.getElementById('lightbox');
  if (lb) { lb.classList.add('open'); document.body.style.overflow = 'hidden'; }
}

function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb) lb.classList.remove('open');
  document.body.style.overflow = '';
  _lbScale = 1;
}

function closeLightboxOnBg(e) {
  if (e.target.id === 'lightbox' || e.target.id === 'lightbox-img-wrap') closeLightbox();
}

function lightboxNav(delta) {
  if (_lbImages.length < 2) return;
  _lbIndex = (_lbIndex + delta + _lbImages.length) % _lbImages.length;
  _lbScale = 1;
  _renderLightbox();
}

function _renderLightbox() {
  const img     = document.getElementById('lightbox-img');
  const counter = document.getElementById('lightbox-counter');
  const prev    = document.querySelector('.lightbox-prev');
  const next    = document.querySelector('.lightbox-next');
  if (!img) return;

  img.src = _lbImages[_lbIndex];
  img.style.transform = 'scale(1)';
  img.style.transition = 'transform 0.2s';

  const multi = _lbImages.length > 1;
  if (counter) { counter.textContent = multi ? `${_lbIndex + 1} / ${_lbImages.length}` : ''; }
  if (prev)    prev.style.display = multi ? '' : 'none';
  if (next)    next.style.display = multi ? '' : 'none';
}

// ── setupLightboxInteractions() ──────────────────────────────
// Called once on page load — sets up touch zoom/swipe and keyboard
function setupLightboxInteractions() {
  const wrap = document.getElementById('lightbox-img-wrap');
  if (!wrap) return;

  // ── Pinch-to-zoom & double-tap zoom ──────────────────────
  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      _lbPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - _lbLastTap < 280) {
        // Double-tap: toggle zoom
        const img = document.getElementById('lightbox-img');
        _lbScale = _lbScale > 1 ? 1 : 2.5;
        if (img) img.style.transform = `scale(${_lbScale})`;
      }
      _lbLastTap  = Date.now();
      _lbSwipeX   = e.touches[0].clientX;
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (_lbPinchDist > 0) {
        _lbScale = Math.min(5, Math.max(0.8, _lbScale * (dist / _lbPinchDist)));
        const img = document.getElementById('lightbox-img');
        if (img) img.style.transform = `scale(${_lbScale})`;
      }
      _lbPinchDist = dist;
    }
  }, { passive: true });

  // ── Swipe left/right to navigate (only when not zoomed) ──
  wrap.addEventListener('touchend', e => {
    if (_lbScale > 1.1) return;
    const dx = e.changedTouches[0].clientX - _lbSwipeX;
    if (Math.abs(dx) > 50) lightboxNav(dx < 0 ? 1 : -1);
  }, { passive: true });

  // ── Keyboard: Escape / arrows ────────────────────────────
  document.addEventListener('keydown', e => {
    const lb = document.getElementById('lightbox');
    if (!lb || !lb.classList.contains('open')) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowRight') lightboxNav(1);
    if (e.key === 'ArrowLeft')  lightboxNav(-1);
  });
}

// ── Auto-fill referral code from URL ─────────────────────────
// If someone visits register.html?ref=ABC123, auto-fill the code
if (window.location.pathname.includes('register.html')) {
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  if (refCode) {
    // Wait for the DOM to load, then fill in the code
    document.addEventListener('DOMContentLoaded', () => {
      const refInput = document.getElementById('referralCode');
      if (refInput) {
        refInput.value = refCode.toUpperCase();
      }
    });
  }
}


// ── Utility / Helper Functions ───────────────────────────────
// Small reusable functions used throughout this file

function showElement(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = '';  // Reset to default display
}

function hideElement(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function showError(box, message) {
  box.textContent = message;
  box.style.display = '';
}

// Turns "2024-01-15T10:30:00.000Z" into "January 15, 2024"
function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}
