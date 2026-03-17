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
      // Dashboard is hidden for all users — only Shop + Cart shown
      hideElement('nav-dashboard');
      showElement('nav-logout');
      hideElement('nav-login');
      hideElement('nav-register');

      // Admin link only visible to admin users
      if (user.isAdmin) showElement('nav-admin');
      else hideElement('nav-admin');

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

    grid.innerHTML = products.map(p => {
      const tiers     = p.priceTiers && p.priceTiers.length > 0 ? p.priceTiers : [];
      const tiersAttr = JSON.stringify(tiers).replace(/"/g, '&quot;');
      const images    = p.images && p.images.length > 0 ? p.images : [p.image];
      const variants  = p.variants && p.variants.length > 0 ? p.variants : [];
      const cid       = `c-${p.id}`;

      // Default price = first variant price (if any), else product base price
      const defaultPrice = variants.length > 0 ? variants[0].price : parseFloat(p.price);

      // Image section: carousel if multiple, plain img if single
      const imageHTML = images.length > 1
        ? `<div class="product-carousel" id="${cid}">
            ${images.map((src, i) => `
              <img src="${src}" alt="${p.name.replace(/"/g, '&quot;')}"
                class="carousel-img${i === 0 ? ' active' : ''}"
                onerror="this.style.display='none'" />
            `).join('')}
            <button class="carousel-btn carousel-prev" type="button" onclick="carouselStep('${cid}',-1)">&#8249;</button>
            <button class="carousel-btn carousel-next" type="button" onclick="carouselStep('${cid}',1)">&#8250;</button>
            <div class="carousel-dots">
              ${images.map((_, i) => `<span class="carousel-dot${i === 0 ? ' active' : ''}" onclick="carouselGo('${cid}',${i})"></span>`).join('')}
            </div>
          </div>`
        : `<div class="product-image">
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

      const tierNote = tiers.length > 0 ? `<span class="tier-note">Bulk pricing available</span>` : '';

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
              <div class="card-qty-controls">
                <button class="card-qty-btn" type="button"
                  onclick="this.nextElementSibling.value = Math.max(1, parseInt(this.nextElementSibling.value) - 1)">−</button>
                <input type="number" class="card-qty-input" value="1" min="1" max="99" />
                <button class="card-qty-btn" type="button"
                  onclick="this.previousElementSibling.value = Math.min(99, parseInt(this.previousElementSibling.value) + 1)">+</button>
              </div>
              <button
                class="btn btn-small"
                data-name="${p.name.replace(/"/g, '&quot;')}"
                data-price="${defaultPrice}"
                data-image="${images[0].replace(/"/g, '&quot;')}"
                data-tiers="${tiersAttr}"
                data-pid="${p.id}"
                onclick="addToCartFromCard(this)"
              >Add to Cart</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    grid.innerHTML = '<p style="text-align:center;color:#777;padding:40px">Could not load products. Is the server running?</p>';
  }
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
        referralCode
      })
    });

    // Parse the server's response (it sends back JSON)
    const data = await response.json();

    if (response.ok) {
      // Success! Show message then redirect to dashboard
      successBox.textContent = 'Account created! Redirecting to your dashboard...';
      showElement('success-message');

      // Wait 1.5 seconds then go to dashboard
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 1500);
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
    // document.getElementById finds an element by its id=""
    document.getElementById('user-username').textContent = user.username;
    document.getElementById('user-referral-code').textContent = user.referralCode;
    document.getElementById('user-referral-count').textContent = user.referralCount;
    document.getElementById('user-created-at').textContent = formatDate(user.createdAt);

    // Account info section
    document.getElementById('info-username').textContent = user.username;
    document.getElementById('info-email').textContent = user.email;
    document.getElementById('info-referred-by').textContent = user.referredBy || 'Nobody (direct signup)';

    // Build the shareable referral link
    // This creates a link like: http://localhost:3000/register.html?ref=ABC123
    const referralLink = `${window.location.origin}/register.html?ref=${user.referralCode}`;
    document.getElementById('referral-link').value = referralLink;

    // Hide the loading spinner and show the content
    hideElement('loading');
    showElement('dashboard-content');

  } catch (err) {
    window.location.href = 'login.html';
  }
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
  }
}

// ── carouselStep() ───────────────────────────────────────────
function carouselStep(id, delta) {
  const c    = document.getElementById(id);
  if (!c) return;
  const imgs = c.querySelectorAll('.carousel-img');
  const dots = c.querySelectorAll('.carousel-dot');
  let cur = 0;
  imgs.forEach((img, i) => { if (img.classList.contains('active')) cur = i; });
  const next = (cur + delta + imgs.length) % imgs.length;
  imgs[cur].classList.remove('active'); imgs[next].classList.add('active');
  if (dots.length) { dots[cur].classList.remove('active'); dots[next].classList.add('active'); }
}

// ── carouselGo() ─────────────────────────────────────────────
function carouselGo(id, index) {
  const c = document.getElementById(id);
  if (!c) return;
  c.querySelectorAll('.carousel-img').forEach((img, i) => img.classList.toggle('active', i === index));
  c.querySelectorAll('.carousel-dot').forEach((dot, i) => dot.classList.toggle('active', i === index));
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

  addToCart(displayName, parseFloat(btn.dataset.price), btn.dataset.image, btn, btn.dataset.tiers, qty);
}

// ── addToCart() ──────────────────────────────────────────────
// name, price, image — product details
// btn       — the button element (flash feedback)
// tiersJSON — JSON string of price tiers
// qty       — how many to add (default 1)
function addToCart(name, price, image, btn, tiersJSON, qty) {
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
    cart.push({ name, basePrice, price: effPrice, image, qty, tiers });
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

// ── updateCartTotals() ───────────────────────────────────────
function updateCartTotals(subtotal) {
  const subtotalEl      = document.getElementById('cart-subtotal');
  const totalEl         = document.getElementById('cart-total');
  const discountLine    = document.getElementById('cart-discount-line');
  const discountAmtEl   = document.getElementById('cart-discount-amount');

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

  const total = Math.max(0, subtotal - discountAmt);
  if (totalEl) totalEl.textContent = '₱' + total.toFixed(2);
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

// ── openCart() ───────────────────────────────────────────────
function openCart() {
  try { renderCart(); } catch(e) { console.error(e); }
  document.getElementById('cart-sidebar').classList.add('open');
  document.getElementById('cart-overlay').classList.add('open');
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
function openCheckoutModal() {
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
  const total       = Math.max(0, subtotal - discountAmt);

  if (discountAmt > 0) {
    summaryHTML += `
      <div class="summary-row" style="color:var(--success)">
        <span>Discount (${discount.name})</span>
        <span>-₱${discountAmt.toFixed(2)}</span>
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

  // Clear previous form inputs
  document.getElementById('order-name').value = '';
  document.getElementById('order-contact').value = '';
  document.getElementById('order-address').value = '';

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
  const total       = Math.max(0, subtotal - discountAmt);

  // Disable button while uploading
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Sending order...';
  errorBox.style.display = 'none';

  // Build FormData — this lets us send both text fields AND a file
  const formData = new FormData();
  formData.append('customerName', name);
  formData.append('contact',      contact);
  formData.append('address',      address);
  formData.append('items',        JSON.stringify(cart));  // cart as JSON string
  formData.append('total',        total);
  formData.append('screenshot',   screenshot);            // the image file

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

    // Clear the cart
    localStorage.removeItem('cart');
    updateCartBadge();

  } catch (err) {
    errorBox.textContent   = 'Cannot connect to server. Is it running?';
    errorBox.style.display = '';
    submitBtn.disabled    = false;
    submitBtn.textContent  = 'Confirm Order';
  }
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
