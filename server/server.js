// ============================================================
// server.js — Backend for BlazeUp Clothing Store
// Handles: auth, products, orders, file uploads, admin routes
// ============================================================

const express  = require('express');
const bcrypt   = require('bcryptjs');
const session  = require('express-session');
const fs       = require('fs');
const path     = require('path');
const multer   = require('multer');   // handles file uploads

const app  = express();
const PORT = process.env.PORT || 3000;

// ── File paths ───────────────────────────────────────────────
const DATA_DIR     = path.join(__dirname, '../data');
const DATA_FILE    = path.join(DATA_DIR, 'users.json');
const PRODUCTS_FILE  = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE    = path.join(DATA_DIR, 'orders.json');
const DISCOUNTS_FILE = path.join(DATA_DIR, 'discounts.json');
const UPLOADS_DIR  = path.join(__dirname, '../public/uploads');

// ── Admin email — change this to your email ──────────────────
const ADMIN_EMAIL  = 'jvmarte20@gmail.com';

// ── Ensure upload folder exists ──────────────────────────────
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Multer config for payment screenshots ────────────────────
// Saves files to public/uploads/ with a timestamped name
const paymentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `payment_${Date.now()}${ext}`);
  }
});

// ── Multer config for product images ─────────────────────────
const productStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../public/assets')),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `product_${Date.now()}${ext}`);
  }
});

const uploadPayment = multer({ storage: paymentStorage });
const uploadProduct = multer({ storage: productStorage });

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use(session({
  secret: 'my-super-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));


// ── Helper Functions ─────────────────────────────────────────

function readUsers() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function saveUsers(users) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

function readProducts() {
  try { return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8')); }
  catch { return []; }
}
function saveProducts(products) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}

function readOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); }
  catch { return []; }
}
function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

function readDiscounts() {
  try { return JSON.parse(fs.readFileSync(DISCOUNTS_FILE, 'utf8')); }
  catch { return []; }
}
function saveDiscounts(discounts) {
  fs.writeFileSync(DISCOUNTS_FILE, JSON.stringify(discounts, null, 2));
}

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function makeUniqueCode(users) {
  let code, isUnique = false;
  while (!isUnique) {
    code = generateReferralCode();
    isUnique = !users.find(u => u.referralCode === code);
  }
  return code;
}

// ── Auto-tag admin user on startup ───────────────────────────
// Finds the admin email and sets isAdmin: true if not already set
(function tagAdmin() {
  const users = readUsers();
  let changed = false;
  users.forEach(u => {
    if (u.email === ADMIN_EMAIL && !u.isAdmin) {
      u.isAdmin = true;
      changed = true;
    }
  });
  if (changed) saveUsers(users);
})();


// ── Middleware: require login ─────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  next();
}

// ── Middleware: require admin ─────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  const user = readUsers().find(u => u.id === req.session.userId);
  if (!user || !user.isAdmin) return res.status(403).json({ error: 'Admin access only.' });
  next();
}


// ════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════

app.post('/api/register', async (req, res) => {
  const { username, email, password, referralCode } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields are required.' });

  const users = readUsers();
  if (users.find(u => u.email === email.toLowerCase()))
    return res.status(400).json({ error: 'Email already registered.' });
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(400).json({ error: 'Username already taken.' });

  const hashedPassword = await bcrypt.hash(password, 10);

  let referredBy = null;
  if (referralCode) {
    const referrer = users.find(u => u.referralCode === referralCode.toUpperCase());
    if (referrer) {
      referredBy = referrer.username;
      referrer.referralCount = (referrer.referralCount || 0) + 1;
    }
  }

  const newUser = {
    id: Date.now().toString(),
    username,
    email: email.toLowerCase(),
    password: hashedPassword,
    isAdmin: email.toLowerCase() === ADMIN_EMAIL,
    referralCode: makeUniqueCode(users),
    referralCount: 0,
    referredBy,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);
  req.session.userId = newUser.id;
  res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const user = readUsers().find(u => u.email === email.toLowerCase());
  if (!user) return res.status(400).json({ error: 'Invalid email or password.' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: 'Invalid email or password.' });

  req.session.userId = user.id;
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  const user = readUsers().find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({
    id: user.id, username: user.username, email: user.email,
    isAdmin: !!user.isAdmin,
    referralCode: user.referralCode, referralCount: user.referralCount,
    referredBy: user.referredBy, createdAt: user.createdAt
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check if current user is admin (used by frontend to show/hide Admin link)
app.get('/api/admin/check', (req, res) => {
  if (!req.session.userId) return res.json({ isAdmin: false });
  const user = readUsers().find(u => u.id === req.session.userId);
  res.json({ isAdmin: !!(user && user.isAdmin) });
});


// ════════════════════════════════════════════════════════════
// PRODUCT ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/products — login required to view shop
app.get('/api/products', requireLogin, (req, res) => {
  res.json(readProducts());
});

// POST /api/admin/products — add a new product (admin only)
app.post('/api/admin/products', requireAdmin, uploadProduct.array('images', 10), (req, res) => {
  const { name, description, price, priceTiers, variants } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price are required.' });

  const products = readProducts();
  const images = req.files && req.files.length > 0
    ? req.files.map(f => `assets/${f.filename}`)
    : ['assets/product1.jpg'];

  const newProduct = {
    id: 'p' + Date.now(),
    name,
    description: description || '',
    price: parseFloat(price),
    priceTiers: priceTiers ? JSON.parse(priceTiers) : [],
    variants:   variants   ? JSON.parse(variants)   : [],
    images,
    image: images[0]
  };
  products.push(newProduct);
  saveProducts(products);
  res.json({ success: true, product: newProduct });
});

// PUT /api/admin/products/:id — edit a product (admin only)
app.put('/api/admin/products/:id', requireAdmin, uploadProduct.array('images', 10), (req, res) => {
  const products = readProducts();
  const idx = products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found.' });

  const { name, description, price, priceTiers, variants } = req.body;
  if (name)                    products[idx].name        = name;
  if (description !== undefined) products[idx].description = description;
  if (price)                   products[idx].price       = parseFloat(price);
  if (priceTiers)              products[idx].priceTiers  = JSON.parse(priceTiers);
  if (variants)                products[idx].variants    = JSON.parse(variants);
  if (req.files && req.files.length > 0) {
    products[idx].images = req.files.map(f => `assets/${f.filename}`);
    products[idx].image  = products[idx].images[0];
  }

  saveProducts(products);
  res.json({ success: true, product: products[idx] });
});

// DELETE /api/admin/products/:id — delete a product (admin only)
app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = readProducts();
  const idx = products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found.' });
  products.splice(idx, 1);
  saveProducts(products);
  res.json({ success: true });
});


// ════════════════════════════════════════════════════════════
// ORDER ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/orders — customer submits an order with payment screenshot
app.post('/api/orders', uploadPayment.single('screenshot'), (req, res) => {
  const { customerName, contact, address, items, total } = req.body;

  if (!customerName || !contact || !address || !items)
    return res.status(400).json({ error: 'All order fields are required.' });

  if (!req.file)
    return res.status(400).json({ error: 'Payment screenshot is required.' });

  const orders = readOrders();
  const newOrder = {
    id: 'ord_' + Date.now(),
    customerName,
    contact,
    address,
    items: JSON.parse(items),      // items is sent as a JSON string
    total: parseFloat(total),
    paymentScreenshot: `uploads/${req.file.filename}`,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  orders.push(newOrder);
  saveOrders(orders);
  res.json({ success: true, orderId: newOrder.id });
});

// GET /api/admin/orders — admin views all orders
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json(readOrders());
});

// GET /api/admin/customers — admin views all registered customers with their orders
app.get('/api/admin/customers', requireAdmin, (req, res) => {
  const users  = readUsers();
  const orders = readOrders();

  const customers = users.map(u => {
    // Find orders loosely matched by customerName to username
    const userOrders = orders.filter(o =>
      o.customerName && u.username &&
      o.customerName.toLowerCase().includes(u.username.toLowerCase())
    );

    return {
      id:           u.id,
      username:     u.username,
      email:        u.email,
      isAdmin:      !!u.isAdmin,
      referralCode: u.referralCode,
      referralCount:u.referralCount,
      referredBy:   u.referredBy,
      createdAt:    u.createdAt,
      orders:       userOrders   // matched orders for this user
    };
  });

  res.json(customers);
});

// PUT /api/admin/orders/:id/status — admin updates order status
app.put('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const orders = readOrders();
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  order.status = req.body.status;
  saveOrders(orders);
  res.json({ success: true });
});


// ════════════════════════════════════════════════════════════
// DISCOUNT ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/discounts — public (logged-in users can load available discounts)
app.get('/api/discounts', requireLogin, (req, res) => {
  res.json(readDiscounts());
});

// POST /api/admin/discounts — create a new discount
app.post('/api/admin/discounts', requireAdmin, (req, res) => {
  const { name, type, value } = req.body;
  if (!name || !type || value === undefined)
    return res.status(400).json({ error: 'Name, type, and value are required.' });

  const discounts = readDiscounts();
  if (discounts.find(d => d.name.toUpperCase() === name.toUpperCase()))
    return res.status(400).json({ error: 'Discount name already exists.' });

  const newDiscount = {
    id: 'd' + Date.now(),
    name: name.toUpperCase(),
    type,   // 'percent' or 'fixed'
    value: parseFloat(value),
    createdAt: new Date().toISOString()
  };
  discounts.push(newDiscount);
  saveDiscounts(discounts);
  res.json({ success: true, discount: newDiscount });
});

// PUT /api/admin/discounts/:id — update a discount
app.put('/api/admin/discounts/:id', requireAdmin, (req, res) => {
  const discounts = readDiscounts();
  const idx = discounts.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Discount not found.' });
  const { name, type, value } = req.body;
  if (name)            discounts[idx].name  = name.toUpperCase();
  if (type)            discounts[idx].type  = type;
  if (value !== undefined) discounts[idx].value = parseFloat(value);
  saveDiscounts(discounts);
  res.json({ success: true, discount: discounts[idx] });
});

// DELETE /api/admin/discounts/:id — delete a discount
app.delete('/api/admin/discounts/:id', requireAdmin, (req, res) => {
  const discounts = readDiscounts();
  const idx = discounts.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Discount not found.' });
  discounts.splice(idx, 1);
  saveDiscounts(discounts);
  res.json({ success: true });
});


// ════════════════════════════════════════════════════════════
// ADMIN CUSTOMER DELETION
// ════════════════════════════════════════════════════════════

// DELETE /api/admin/customers/:id — remove a customer account
app.delete('/api/admin/customers/:id', requireAdmin, (req, res) => {
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found.' });
  if (users[idx].isAdmin) return res.status(403).json({ error: 'Cannot delete admin accounts.' });
  users.splice(idx, 1);
  saveUsers(users);
  res.json({ success: true });
});


// ── Start server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
