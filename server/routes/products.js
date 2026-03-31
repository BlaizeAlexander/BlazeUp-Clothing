// ============================================================
// routes/products.js — Product CRUD
// ============================================================

const express = require('express');
const { query } = require('../db');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { uploadProduct, handleUploadError } = require('../middleware/upload');

const router = express.Router();

/** Translate a DB row to the camelCase shape the frontend expects. */
function mapProduct(row) {
  return {
    id:            row.id,
    name:          row.name,
    description:   row.description,
    price:         parseFloat(row.price),
    costPrice:     parseFloat(row.cost_price),
    stockQuantity: row.stock_quantity,
    category:      row.category,
    priceTiers:    row.price_tiers,   // JSONB — already parsed by pg
    variants:      row.variants,
    images:        row.images,
    image:         row.image,
    createdAt:     row.created_at
  };
}

// ── GET /api/products ─────────────────────────────────────────
router.get('/products', requireLogin, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(rows.map(mapProduct));
  } catch (err) { next(err); }
});

// ── POST /api/admin/products ──────────────────────────────────
router.post('/admin/products', requireLogin, requireAdmin,
  (req, res, next) => {
    uploadProduct.array('images', 10)(req, res, err => {
      if (err) return handleUploadError(err, req, res, next);
      next();
    });
  },
  async (req, res, next) => {
    const { name, description, price, priceTiers, variants, costPrice, stockQuantity, category } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'Name and price are required.' });

    const images = req.files && req.files.length
      ? req.files.map(f => `assets/${f.filename}`)
      : [];
    const image = images[0] || '';

    try {
      const { rows } = await query(`
        INSERT INTO products
          (name, description, price, cost_price, stock_quantity, category,
           price_tiers, variants, images, image)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)
        RETURNING *
      `, [
        name,
        description || '',
        parseFloat(price),
        parseFloat(costPrice  || 0),
        parseInt(stockQuantity || 0, 10),
        category || '',
        JSON.stringify(priceTiers ? JSON.parse(priceTiers) : []),
        JSON.stringify(variants   ? JSON.parse(variants)   : []),
        JSON.stringify(images),
        image
      ]);
      res.json({ success: true, product: mapProduct(rows[0]) });
    } catch (err) { next(err); }
  }
);

// ── PUT /api/admin/products/:id ───────────────────────────────
router.put('/admin/products/:id', requireLogin, requireAdmin,
  (req, res, next) => {
    uploadProduct.array('images', 10)(req, res, err => {
      if (err) return handleUploadError(err, req, res, next);
      next();
    });
  },
  async (req, res, next) => {
    const { id } = req.params;
    const { name, description, price, category, costPrice, stockQuantity, priceTiers, variants, existingImages } = req.body;
    try {
      const existing = await query('SELECT * FROM products WHERE id = $1', [id]);
      if (!existing.rows.length) return res.status(404).json({ error: 'Product not found.' });

      const product = existing.rows[0];
      const newFiles = req.files && req.files.length
        ? req.files.map(f => `assets/${f.filename}`)
        : [];
      let kept = [];
      if (existingImages !== undefined) {
        try { kept = JSON.parse(existingImages); } catch { kept = []; }
      }
      const allImages = [...kept, ...newFiles];
      const image = allImages.length ? allImages[0] : product.image;

      const { rows } = await query(`
        UPDATE products SET
          name           = COALESCE($1, name),
          description    = COALESCE($2, description),
          price          = COALESCE($3, price),
          cost_price     = COALESCE($4, cost_price),
          stock_quantity = COALESCE($5, stock_quantity),
          category       = COALESCE($6, category),
          price_tiers    = COALESCE($7::jsonb, price_tiers),
          variants       = COALESCE($8::jsonb, variants),
          images         = $9::jsonb,
          image          = $10
        WHERE id = $11
        RETURNING *
      `, [
        name             || null,
        description !== undefined ? description : null,
        price            ? parseFloat(price)               : null,
        costPrice  !== undefined ? parseFloat(costPrice)   : null,
        stockQuantity !== undefined ? parseInt(stockQuantity, 10) : null,
        category   !== undefined ? category                : null,
        priceTiers       ? JSON.stringify(JSON.parse(priceTiers)) : null,
        variants         ? JSON.stringify(JSON.parse(variants))   : null,
        JSON.stringify(allImages.length ? allImages : product.images),
        image,
        id
      ]);
      res.json({ success: true, product: mapProduct(rows[0]) });
    } catch (err) { next(err); }
  }
);

// ── DELETE /api/admin/products/:id ───────────────────────────
router.delete('/admin/products/:id', requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const result = await query('DELETE FROM products WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Product not found.' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── PUT /api/admin/products/:id/inventory ────────────────────
router.put('/admin/products/:id/inventory', requireLogin, requireAdmin, async (req, res, next) => {
  const { stockQuantity, costPrice, category } = req.body;
  try {
    const { rows } = await query(`
      UPDATE products SET
        stock_quantity = COALESCE($1, stock_quantity),
        cost_price     = COALESCE($2, cost_price),
        category       = COALESCE($3, category)
      WHERE id = $4
      RETURNING *
    `, [
      stockQuantity !== undefined ? parseInt(stockQuantity, 10) : null,
      costPrice     !== undefined ? parseFloat(costPrice)       : null,
      category      !== undefined ? category                    : null,
      req.params.id
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found.' });
    res.json({ success: true, product: mapProduct(rows[0]) });
  } catch (err) { next(err); }
});

module.exports = router;
