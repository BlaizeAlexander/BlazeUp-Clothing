# BlazeUp Clothing Store — CLAUDE.md

## Project overview
Full-stack clothing store web app called **BlazeUp**. Node.js + Express backend, vanilla JS / HTML / CSS frontend. Deployed on Render.

## Tech stack
| Layer | Technology |
|---|---|
| Runtime | Node.js + Express 4 |
| Database | PostgreSQL (raw `pg`, no ORM) |
| Auth | JWT in HTTP-only `SameSite=strict` cookies |
| File storage | Supabase Storage (images never written to disk) |
| Security | helmet, express-rate-limit, express-validator, bcryptjs (12 rounds) |
| File uploads | multer (memoryStorage → Supabase) |
| Dev server | nodemon |
| Deployment | Render (free tier, spins down) |

## Project structure
```
server/
  server.js               # Entry point, middleware, route mounting
  db.js                   # pg Pool, query() and getClient() helpers
  middleware/
    auth.js               # issueToken, clearToken, requireLogin, requireAdmin, optionalLogin
    upload.js             # multer configs + uploadToSupabase()
  routes/
    auth.js               # /register, /login, /logout, /me, /admin/check, user approval
    products.js           # Product CRUD + inventory
    orders.js             # Place orders, order management, customers
    discounts.js          # Discount code CRUD
    finance.js            # Finance overview, expenses, receivables, payables
    settings.js           # App settings, QR code, social links, shipping fee
    profile.js            # User profile, avatar, admin points management
db/
  schema.sql              # Full schema — run once with npm run db:init
  migrate.js              # One-time JSON → PG import (legacy)
public/
  index.html              # Storefront
  admin.html              # Admin panel
  dashboard.html          # User dashboard
  login.html / register.html
  js/main.js              # Storefront JS
  js/admin.js             # Admin JS
  css/style.css
```

## npm scripts
```bash
npm start          # node server/server.js
npm run dev        # nodemon server/server.js
npm run db:init    # psql $DATABASE_URL -f db/schema.sql
npm run db:migrate # node db/migrate.js (legacy one-time use)
```

## Environment variables
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret (must be set in prod) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `RENDER` | Set by Render — enables HTTPS-only cookies and SSL |
| `PORT` | HTTP port (default 3000) |

## Database schema summary

### Tables
- **users** — UUID PK, `role` (`user`|`admin`), `status` (`pending`|`approved`|`denied`), `points`, `referral_code`, `referred_by`, `avatar_url`
- **products** — UUID PK, `price`, `cost_price`, `stock_quantity`, `price_tiers` (JSONB), `variants` (JSONB), `images` (JSONB array of Supabase URLs)
- **orders** — UUID PK, `user_id` (nullable for guests), `status` (`pending`|`confirmed`|`shipped`|`delivered`|`cancelled`), `points_used`
- **order_items** — snapshots `name`, `price`, `base_price`, `cost_at_sale` at time of sale
- **discounts** — `name` (unique, stored UPPERCASE), `type` (`percent`|`fixed`), `value`
- **expenses** — `category`, `amount`, `date` (DATE type)
- **receivables** — `status` (`pending`|`paid`|`overdue`|`open`|`partial`), auto-created on order confirmation
- **payables** — `status` (`unpaid`|`partial`|`overdue`|`paid`)
- **settings** — single row (`id = 1`), `points_system_enabled`, `purchase_points_rate`, `referral_reward_points`, `payment_qr_code_path`, `shipping_fee`, social URLs

### Key constraints
- `settings` has exactly one row enforced by `CHECK (id = 1)` — always update with `WHERE id = 1`
- IDs are UUIDs (not timestamp strings)
- `role = 'admin'` column determines admin, not a hardcoded email

## Authentication
- Cookie name: `blazeup_token`
- JWT payload: `{ sub: user.id, role: user.role }`, expires in 24h
- Middleware chain for protected routes: `requireLogin` → `requireAdmin`
- `optionalLogin` for routes that serve both guests and users (e.g. POST /api/orders)
- New accounts start as `status = 'pending'`, must be approved by admin before login works

## File uploads
- All uploads use `multer.memoryStorage()` — **never written to local disk**
- Immediately pushed to Supabase Storage via `uploadToSupabase(file, bucket)`
- Returns the public URL stored in the database
- Max 10 MB (products/payments/QR), 2 MB (avatars)
- Allowed types: JPG, PNG only

## API route patterns
- Public routes: `GET /api/products`, `GET /api/payment-qr`, `GET /api/social-links`, `GET /api/shipping-fee`
- Logged-in user routes: `GET /api/me`, `GET /api/orders/my`, `PUT /api/profile`, `POST /api/profile/avatar`
- Admin routes: all under `/api/admin/*`
- Rate limits: `/api/login` and `/api/register` — 10 req/15 min; global — 200 req/15 min

## Business logic notes

### Order confirmation side effects (transactional)
When an order is moved to `confirmed`:
1. Stock decremented for each product
2. Loyalty points awarded to buyer (based on `purchase_points_rate` in settings)
3. A receivable auto-created (`status = 'paid'`) if one doesn't exist

When cancelled from a previously confirmed state: stock is restored.

### Finance overview
Revenue, COGS, gross profit, operating profit calculated server-side in `GET /api/admin/finance/overview`. All 8 aggregate queries run in parallel with `Promise.all`.

### Loyalty points
- Earned on order confirmation: `floor(total / 100 * purchase_points_rate)`
- Referral points awarded when referred user is approved
- `FOR UPDATE` lock used during checkout to prevent double-spend

### Per-product price tiers
Stored as JSONB array on each product (`price_tiers`). Applied client-side at checkout. Each tier: `{ minQty, price }`.

## Startup migrations
`server.js` runs `runMigrations()` on every start — uses `ALTER TABLE … ADD COLUMN IF NOT EXISTS` so it's safe to re-run. Non-fatal if it fails.

## Security practices
- `bcrypt` with 12 rounds
- Timing-safe login: always runs `bcrypt.compare` even when user not found (dummy hash)
- `helmet` with relaxed CSP (frontend uses inline scripts/styles)
- `express-validator` for register/login input
- JWT in HTTP-only cookies (not localStorage)
- `trust proxy 1` set for Render's reverse proxy

## Frontend
Vanilla JS, no framework. Single-page-like HTML files. Admin panel is `admin.html` + `admin.js`. Storefront is `index.html` + `main.js`. No build step.
