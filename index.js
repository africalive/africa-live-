const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'AfricaLive2026SecretKey';
const DB_PATH = path.join(__dirname, 'africa-live.db');

let db;

async function initDatabase() {
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      coins INTEGER DEFAULT 100,
      diamonds INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      followers INTEGER DEFAULT 0,
      following INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS panels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'general',
      host_id INTEGER NOT NULL,
      is_live INTEGER DEFAULT 1,
      listeners INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      panel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      panel_id INTEGER,
      gift_type TEXT NOT NULL,
      gift_value INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id, following_id)
    )
  `);

  saveDatabase();
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
  return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] };
}

// Middleware
app.use(cors());
app.use(express.json());

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// ============ AUTH ROUTES ============

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = dbGet('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = dbRun('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, hashedPassword]);
    
    const token = jwt.sign({ id: result.lastInsertRowid, username, email }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ 
      token, 
      user: { id: result.lastInsertRowid, username, email, coins: 100, diamonds: 0, level: 1 } 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ 
      token, 
      user: { id: user.id, username: user.username, email: user.email, coins: user.coins, diamonds: user.diamonds, level: user.level } 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  const user = dbGet('SELECT id, username, email, coins, diamonds, level, followers, following FROM users WHERE id = ?', [req.user.id]);
  res.json({ user });
});

// ============ PANEL ROUTES ============

app.get('/api/panels', (req, res) => {
  const panels = dbAll(`
    SELECT p.*, u.username as host_name, u.avatar as host_avatar 
    FROM panels p 
    JOIN users u ON p.host_id = u.id 
    WHERE p.is_live = 1 
    ORDER BY p.listeners DESC
  `);
  res.json({ panels });
});

app.post('/api/panels', authenticateToken, (req, res) => {
  const { title, description, category } = req.body;
  const result = dbRun('INSERT INTO panels (title, description, category, host_id) VALUES (?, ?, ?, ?)', [title, description || '', category || 'general', req.user.id]);
  res.json({ panel: { id: result.lastInsertRowid, title, description, category, host_id: req.user.id, is_live: 1, listeners: 0 } });
});

app.put('/api/panels/:id/end', authenticateToken, (req, res) => {
  dbRun('UPDATE panels SET is_live = 0 WHERE id = ? AND host_id = ?', [parseInt(req.params.id), req.user.id]);
  res.json({ success: true });
});

// ============ GIFT ROUTES ============

const GIFT_TYPES = {
  heart: { name: 'Heart', value: 10 },
  fire: { name: 'Fire', value: 50 },
  diamond: { name: 'Diamond', value: 100 },
  music: { name: 'Music', value: 25 },
  star: { name: 'Star', value: 75 },
  crown: { name: 'Crown', value: 500 }
};

app.post('/api/gifts/send', authenticateToken, (req, res) => {
  const { receiver_id, panel_id, gift_type } = req.body;
  const gift = GIFT_TYPES[gift_type];
  if (!gift) return res.status(400).json({ error: 'Invalid gift type' });

  const sender = dbGet('SELECT coins FROM users WHERE id = ?', [req.user.id]);
  if (sender.coins < gift.value) {
    return res.status(400).json({ error: 'Not enough coins' });
  }

  dbRun('UPDATE users SET coins = coins - ? WHERE id = ?', [gift.value, req.user.id]);
  dbRun('UPDATE users SET diamonds = diamonds + ? WHERE id = ?', [Math.floor(gift.value * 0.7), receiver_id]);
  dbRun('INSERT INTO gifts (sender_id, receiver_id, panel_id, gift_type, gift_value) VALUES (?, ?, ?, ?, ?)', [req.user.id, receiver_id, panel_id, gift_type, gift.value]);

  res.json({ success: true, remaining_coins: sender.coins - gift.value });
});

app.get('/api/gifts/shop', (req, res) => {
  res.json({ gifts: GIFT_TYPES });
});

// ============ USER ROUTES ============

app.get('/api/users/:id', (req, res) => {
  const user = dbGet('SELECT id, username, email, avatar, bio, coins, diamonds, level, followers, following, created_at FROM users WHERE id = ?', [parseInt(req.params.id)]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

app.put('/api/users/profile', authenticateToken, (req, res) => {
  const { username, bio, avatar } = req.body;
  if (username) dbRun('UPDATE users SET username = ? WHERE id = ?', [username, req.user.id]);
  if (bio) dbRun('UPDATE users SET bio = ? WHERE id = ?', [bio, req.user.id]);
  if (avatar) dbRun('UPDATE users SET avatar = ? WHERE id = ?', [avatar, req.user.id]);
  res.json({ success: true });
});

app.post('/api/users/:id/follow', authenticateToken, (req, res) => {
  try {
    dbRun('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)', [req.user.id, parseInt(req.params.id)]);
    dbRun('UPDATE users SET followers = followers + 1 WHERE id = ?', [parseInt(req.params.id)]);
    dbRun('UPDATE users SET following = following + 1 WHERE id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: 'Already following' });
  }
});

app.post('/api/wallet/buy-coins', authenticateToken, (req, res) => {
  const { amount } = req.body;
  dbRun('UPDATE users SET coins = coins + ? WHERE id = ?', [amount || 100, req.user.id]);
  const user = dbGet('SELECT coins, diamonds FROM users WHERE id = ?', [req.user.id]);
  res.json({ success: true, coins: user.coins, diamonds: user.diamonds });
});

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Africa Live API', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to Africa Live API', 
    version: '1.0.0',
    endpoints: {
      auth: ['/api/auth/register', '/api/auth/login', '/api/auth/verify'],
      panels: ['/api/panels'],
      gifts: ['/api/gifts/shop', '/api/gifts/send'],
      users: ['/api/users/:id', '/api/users/profile'],
      wallet: ['/api/wallet/buy-coins'],
      health: ['/api/health']
    }
  });
});

// ============ WEBSOCKET ============

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-panel', (data) => {
    const { panelId, userId, username } = data;
    socket.join(`panel-${panelId}`);
    dbRun('UPDATE panels SET listeners = listeners + 1 WHERE id = ?', [panelId]);
    io.to(`panel-${panelId}`).emit('user-joined', { userId, username, socketId: socket.id });
  });

  socket.on('leave-panel', (data) => {
    const { panelId, userId, username } = data;
    socket.leave(`panel-${panelId}`);
    dbRun('UPDATE panels SET listeners = MAX(0, listeners - 1) WHERE id = ?', [panelId]);
    io.to(`panel-${panelId}`).emit('user-left', { userId, username });
  });

  socket.on('send-message', (data) => {
    const { panelId, userId, username, content } = data;
    dbRun('INSERT INTO messages (panel_id, user_id, username, content) VALUES (?, ?, ?, ?)', [panelId, userId, username, content]);
    io.to(`panel-${panelId}`).emit('new-message', { userId, username, content, timestamp: new Date().toISOString() });
  });

  socket.on('send-gift', (data) => {
    const { panelId, senderId, senderName, receiverId, giftType } = data;
    io.to(`panel-${panelId}`).emit('gift-received', { senderId, senderName, receiverId, giftType });
  });

  socket.on('offer', (data) => {
    socket.to(`panel-${data.panelId}`).emit('offer', { offer: data.offer, from: socket.id });
  });

  socket.on('answer', (data) => {
    socket.to(data.to).emit('answer', { answer: data.answer, from: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(`panel-${data.panelId}`).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start server
async function start() {
  await initDatabase();
  server.listen(PORT, () => {
    console.log(`Africa Live API running on port ${PORT}`);
    console.log(`WebSocket server ready`);
  });
}

start().catch(console.error);
