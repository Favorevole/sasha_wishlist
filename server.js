require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Auto-create table on startup
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS items (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      link TEXT DEFAULT '',
      price INTEGER,
      type TEXT DEFAULT '',
      photo TEXT DEFAULT '',
      description TEXT DEFAULT '',
      reserved BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Migrate: add description column if missing
  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''
  `);
  // Migrate: add reserved_by column if missing
  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS reserved_by TEXT DEFAULT ''
  `);
  // Donations table for crowdfunding
  await pool.query(`
    CREATE TABLE IF NOT EXISTS donations (
      id UUID PRIMARY KEY,
      item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      name TEXT DEFAULT '',
      amount INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// Multer config — memory storage, convert to base64
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic|heif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = /image\//.test(file.mimetype);
    cb(null, ext || mimeOk);
  }
});

function fileToBase64(file) {
  if (!file) return '';
  const base64 = file.buffer.toString('base64');
  return `data:${file.mimetype};base64,${base64}`;
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'wishlist-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Auth middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Hash password on first run
async function ensurePasswordHash() {
  const plain = process.env.ADMIN_PASSWORD || 'admin';
  if (!process.env._HASHED_PASSWORD) {
    process.env._HASHED_PASSWORD = await bcrypt.hash(plain, 10);
  }
}

// Serve index.html for /admin route (SPA)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- AUTH ROUTES ---

app.post('/api/login', async (req, res) => {
  await ensurePasswordHash();
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';

  if (username !== adminUser) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const match = await bcrypt.compare(password, process.env._HASHED_PASSWORD);
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// --- ITEM ROUTES ---

app.get('/api/items', async (req, res) => {
  const isAdminReq = req.session && req.session.isAdmin;
  const cols = isAdminReq
    ? 'i.id, i.name, i.link, i.price, i.type, i.photo, i.description, i.reserved, i.reserved_by AS "reservedBy", i.created_at AS "createdAt"'
    : 'i.id, i.name, i.link, i.price, i.type, i.photo, i.description, i.reserved, i.created_at AS "createdAt"';
  const donorAgg = ', COALESCE(SUM(d.amount), 0)::int AS funded';
  const result = await pool.query(
    `SELECT ${cols}${donorAgg}
     FROM items i
     LEFT JOIN donations d ON d.item_id = i.id
     GROUP BY i.id
     ORDER BY i.created_at ASC`
  );
  res.json(result.rows);
});

app.post('/api/items', requireAdmin, upload.single('photo'), async (req, res) => {
  const id = uuidv4();
  const name = req.body.name || '';
  const link = req.body.link || '';
  const price = req.body.price ? Number(req.body.price) : null;
  const type = req.body.type || '';
  const photo = fileToBase64(req.file);
  const description = req.body.description || '';

  const result = await pool.query(
    `INSERT INTO items (id, name, link, price, type, photo, description, reserved)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false)
     RETURNING id, name, link, price, type, photo, description, reserved, created_at AS "createdAt"`,
    [id, name, link, price, type, photo, description]
  );
  res.status(201).json(result.rows[0]);
});

app.put('/api/items/:id', requireAdmin, upload.single('photo'), async (req, res) => {
  // Check item exists
  const existing = await pool.query('SELECT id FROM items WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Not found' });

  const fields = [];
  const values = [];
  let idx = 1;

  if (req.body.name !== undefined) { fields.push(`name = $${idx++}`); values.push(req.body.name); }
  if (req.body.link !== undefined) { fields.push(`link = $${idx++}`); values.push(req.body.link); }
  if (req.body.price !== undefined) { fields.push(`price = $${idx++}`); values.push(req.body.price ? Number(req.body.price) : null); }
  if (req.body.type !== undefined) { fields.push(`type = $${idx++}`); values.push(req.body.type); }
  if (req.file) { fields.push(`photo = $${idx++}`); values.push(fileToBase64(req.file)); }
  if (req.body.description !== undefined) { fields.push(`description = $${idx++}`); values.push(req.body.description); }

  if (fields.length === 0) {
    const current = await pool.query(
      'SELECT id, name, link, price, type, photo, description, reserved, created_at AS "createdAt" FROM items WHERE id = $1',
      [req.params.id]
    );
    return res.json(current.rows[0]);
  }

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE items SET ${fields.join(', ')} WHERE id = $${idx}
     RETURNING id, name, link, price, type, photo, description, reserved, created_at AS "createdAt"`,
    values
  );
  res.json(result.rows[0]);
});

app.delete('/api/items/:id', requireAdmin, async (req, res) => {
  const result = await pool.query('DELETE FROM items WHERE id = $1 RETURNING id', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.post('/api/items/:id/reserve', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'Phone number is required' });

  const normalized = phone.replace(/[\s\-\(\)]/g, '');
  const check = await pool.query('SELECT reserved FROM items WHERE id = $1', [req.params.id]);
  if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  if (check.rows[0].reserved) return res.status(400).json({ error: 'Already reserved' });

  await pool.query('UPDATE items SET reserved = true, reserved_by = $2 WHERE id = $1', [req.params.id, normalized]);
  res.json({ ok: true });
});

app.post('/api/items/:id/unreserve', async (req, res) => {
  const check = await pool.query('SELECT id, reserved_by FROM items WHERE id = $1', [req.params.id]);
  if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });

  const isAdminReq = req.session && req.session.isAdmin;
  if (!isAdminReq) {
    const { phone } = req.body;
    if (!phone || !phone.trim()) return res.status(400).json({ error: 'Phone number is required' });
    const normalized = phone.replace(/[\s\-\(\)]/g, '');
    if (normalized !== check.rows[0].reserved_by) {
      return res.status(403).json({ error: 'Phone number does not match' });
    }
  }

  await pool.query('UPDATE items SET reserved = false, reserved_by = $2 WHERE id = $1', [req.params.id, '']);
  res.json({ ok: true });
});

// --- DONATION ROUTES ---

app.post('/api/items/:id/donate', async (req, res) => {
  const { phone, name, amount } = req.body;
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'Phone number is required' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount must be greater than 0' });

  const check = await pool.query('SELECT id FROM items WHERE id = $1', [req.params.id]);
  if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });

  const id = uuidv4();
  const normalized = phone.trim().replace(/[\s\-\(\)]/g, '');
  await pool.query(
    'INSERT INTO donations (id, item_id, phone, name, amount) VALUES ($1, $2, $3, $4, $5)',
    [id, req.params.id, normalized, name || '', Number(amount)]
  );
  res.json({ ok: true });
});

app.post('/api/items/:id/undonate', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'Phone number is required' });
  const normalized = phone.trim().replace(/[\s\-\(\)]/g, '');
  const result = await pool.query('DELETE FROM donations WHERE item_id = $1 AND phone = $2 RETURNING id', [req.params.id, normalized]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'No donations found for this phone number' });
  res.json({ ok: true });
});

app.get('/api/items/:id/donations', async (req, res) => {
  const result = await pool.query(
    'SELECT name, amount FROM donations WHERE item_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json(result.rows);
});

// Start
async function start() {
  await initDB();
  await ensurePasswordHash();
  app.listen(PORT, () => {
    console.log(`Wishlist server running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
