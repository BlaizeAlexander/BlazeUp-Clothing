# BlazeUp Clothing Store

Full-stack e-commerce web app for the **BlazeUp** streetwear brand.

---

## Quick Start

```bash
# 1. Install dependencies (only needed once)
npm install

# 2. Start the server
npm start          # production
npm run dev        # auto-restarts when you save files (nodemon)

# 3. Open in browser
http://localhost:3000
```

---

## Pages

| Page | URL | Who can see it |
|------|-----|----------------|
| Shop / Home | `/` | Logged-in users |
| Login | `/login.html` | Everyone |
| Register | `/register.html` | Everyone |
| My Profile | `/dashboard.html` | Logged-in users |
| Admin Dashboard | `/admin.html` | Admin only |
| Stakeholder Dashboard | `/stakeholder.html` | Admin only |

---

## Features

### Authentication
- Register with username, email, password, contact number, and optional referral code
- Passwords hashed with **bcrypt** — never stored in plain text
- Session-based login (cookie stored for 24 hours)
- Protected routes redirect to `/login.html`

### User Profile (`/dashboard.html`)
- View points balance, referral code, referral count
- Edit contact number and pinned delivery address (auto-fills checkout)
- See full order history with status badges

### Referral System
- Every user gets a unique 8-character code on registration
- Share a link like `http://localhost:3000/register.html?ref=YOURCODE`
- Referrer earns **50 points** when someone signs up with their code

### Points System
| Event | Points Earned |
|-------|--------------|
| Friend uses your referral code | +50 pts |
| Order confirmed by admin | +1 pt per ₱100 spent |
| Admin manual adjustment | any amount |

### Shopping & Orders
- Cart saved in **localStorage** (persists between page refreshes)
- Bulk pricing tiers — price drops when you order more
- Size/variant selection (e.g. Small / Medium / Large)
- Checkout form auto-fills from your saved profile
- Upload a GCash screenshot as proof of payment
- Discount codes (created by admin)

### Admin Dashboard (`/admin.html`)
Set your admin email in `server/server.js`:
```js
const ADMIN_EMAIL = 'your@email.com';
```

Admin tabs:
- **Products** — add, edit, delete products with multiple photos and price tiers
- **Orders** — view all orders, update status (Pending → Confirmed → Shipped → Delivered)
- **Customers** — view all users, adjust points, see order history per user
- **Discounts** — create percent or fixed-amount discount codes

### Stakeholder Dashboard (`/stakeholder.html`)
- Total revenue, orders, pending payments, customer count
- Bar chart: monthly revenue
- Line charts: monthly orders + user growth
- Top-selling products with bar indicators
- Accessible to admin only

---

## Project Structure

```
clothing-store/
├── server/
│   └── server.js         ← Express backend, all API routes
├── public/
│   ├── index.html         ← Shop / Home
│   ├── login.html         ← Login form
│   ├── register.html      ← Register form
│   ├── dashboard.html     ← User profile & order history
│   ├── admin.html         ← Admin dashboard
│   ├── stakeholder.html   ← Stakeholder financial view
│   ├── css/
│   │   └── style.css      ← All styles (CSS variables at top)
│   ├── js/
│   │   ├── main.js        ← Shop, cart, checkout, auth, profile
│   │   ├── admin.js       ← Admin panel logic
│   │   └── stakeholder.js ← Stakeholder charts
│   ├── assets/            ← Logo + product images
│   └── uploads/           ← Payment screenshots (auto-created)
└── data/
    ├── users.json         ← User accounts
    ├── products.json      ← Product catalog
    ├── orders.json        ← Customer orders
    └── discounts.json     ← Discount codes
```

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/register` | Create account |
| POST | `/api/login` | Log in |
| POST | `/api/logout` | Log out |
| GET | `/api/me` | Current user info |
| PUT | `/api/profile` | Update contact/location |
| GET | `/api/products` | List all products |
| POST | `/api/orders` | Submit order (with screenshot) |
| GET | `/api/orders/my` | My order history |
| GET | `/api/discounts` | List active discounts |
| GET | `/api/admin/orders` | Admin: all orders |
| PUT | `/api/admin/orders/:id/status` | Admin: update status |
| GET | `/api/admin/customers` | Admin: all users |
| PUT | `/api/admin/users/:id/points` | Admin: adjust points |
| POST | `/api/admin/products` | Admin: add product |
| PUT | `/api/admin/products/:id` | Admin: edit product |
| DELETE | `/api/admin/products/:id` | Admin: delete product |
| GET | `/api/stakeholder` | Stakeholder stats |

---

## Customizing

- **Colors** — edit CSS variables at the top of `public/css/style.css`
- **Admin email** — change `ADMIN_EMAIL` in `server/server.js`
- **Points rules** — search for `pointsEarned` in `server.js` to change the ratio
- **Referral bonus** — search for `+ 50` in `server.js` to change the reward
