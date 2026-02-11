require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'wishlist.json');

// Multer config for photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'wishlist-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Ensure data/uploads directories and initial data file exist
function ensureDirectories() {
  const dataDir = path.join(__dirname, 'data');
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ items: [] }, null, 2), 'utf-8');
  }
}
ensureDirectories();

// Data helpers
function readData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

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

app.get('/api/items', (req, res) => {
  const data = readData();
  res.json(data.items);
});

app.post('/api/items', requireAdmin, upload.single('photo'), (req, res) => {
  const data = readData();
  const item = {
    id: uuidv4(),
    name: req.body.name || '',
    link: req.body.link || '',
    price: req.body.price ? Number(req.body.price) : null,
    type: req.body.type || '',
    photo: req.file ? `uploads/${req.file.filename}` : '',
    reserved: false,
    createdAt: new Date().toISOString()
  };
  data.items.push(item);
  writeData(data);
  res.status(201).json(item);
});

app.put('/api/items/:id', requireAdmin, upload.single('photo'), (req, res) => {
  const data = readData();
  const idx = data.items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const item = data.items[idx];
  if (req.body.name !== undefined) item.name = req.body.name;
  if (req.body.link !== undefined) item.link = req.body.link;
  if (req.body.price !== undefined) item.price = req.body.price ? Number(req.body.price) : null;
  if (req.body.type !== undefined) item.type = req.body.type;
  if (req.file) {
    // Delete old photo
    if (item.photo) {
      const oldPath = path.join(__dirname, item.photo);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    item.photo = `uploads/${req.file.filename}`;
  }

  data.items[idx] = item;
  writeData(data);
  res.json(item);
});

app.delete('/api/items/:id', requireAdmin, (req, res) => {
  const data = readData();
  const idx = data.items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const item = data.items[idx];
  // Delete photo file
  if (item.photo) {
    const photoPath = path.join(__dirname, item.photo);
    if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
  }

  data.items.splice(idx, 1);
  writeData(data);
  res.json({ ok: true });
});

app.post('/api/items/:id/reserve', (req, res) => {
  const data = readData();
  const idx = data.items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  if (data.items[idx].reserved) {
    return res.status(400).json({ error: 'Already reserved' });
  }

  data.items[idx].reserved = true;
  writeData(data);
  res.json({ ok: true });
});

app.post('/api/items/:id/unreserve', requireAdmin, (req, res) => {
  const data = readData();
  const idx = data.items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  data.items[idx].reserved = false;
  writeData(data);
  res.json({ ok: true });
});

// Start
ensurePasswordHash().then(() => {
  app.listen(PORT, () => {
    console.log(`Wishlist server running at http://localhost:${PORT}`);
  });
});
