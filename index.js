const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'AfricaLive2026SecretKey';

// Database setup
const db = new Database(path.join(__dirname, 'africa-live.db'));
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
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
  );

  CREATE TABLE IF NOT EXISTS panels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'general',
    host_id INTEGER NOT NULL,
    is_live INTEGER DEFAULT 1,
    listeners INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (host_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_id) REFERENCES panels(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS gifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    panel_id INTEGER,
    gift_type TEXT NOT NULL,
    gift_value INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(follower_id, following_id)
  );
`);

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

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(username, email, hashedPassword);
    
    const token = jwt.sign({ id: result.lastInsertRowid, username, email }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ 
      token, 
      user: { id: result.lastInsertRowid, username, email, coins: 100, diamonds: 0, level: 1 } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
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
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, username, email, coins, diamonds, level, followers, following FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

// ============ PANEL ROUTES ============

// Get all live panels
app.get('/api/panels', (req, res) => {
  const panels = db.prepare(`
    SELECT p.*, u.username as host_name, u.avatar as host_avatar 
    FROM panels p 
    JOIN users u ON p.host_id = u.id 
    WHERE p.is_live = 1 
    ORDER BY p.listeners DESC
  `).all();
  res.json({ panels });
});

// Create panel
app.post('/api/panels', authenticateToken, (req, res) => {
  const { title, description, category } = req.body;
  const result = db.prepare('INSERT INTO panels (title, description, category, host_id) VALUES (?, ?, ?, ?)').run(title, description || '', category || 'general', req.user.id);
  res.json({ panel: { id: result.lastInsertRowid, title, description, category, host_id: req.user.id, is_live: 1, listeners: 0 } });
});

// End panel
app.put('/api/panels/:id/end', authenticateToken, (req, res) => {
  db.prepare('UPDATE panels SET is_live = 0 WHERE id = ? AND host_id = ?').run(req.params.id, req.user.id);
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

// Send gift
app.post('/api/gifts/send', authenticateToken, (req, res) => {
  const { receiver_id, panel_id, gift_type } = req.body;
  const gift = GIFT_TYPES[gift_type];
  if (!gift) return res.status(400).json({ error: 'Invalid gift type' });

  const sender = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.user.id);
  if (sender.coins < gift.value) {
    return res.status(400).json({ error: 'Not enough coins' });
  }

  db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(gift.value, req.user.id);
  db.prepare('UPDATE users SET diamonds = diamonds + ? WHERE id = ?').run(Math.floor(gift.value * 0.7), receiver_id);
  db.prepare('INSERT INTO gifts (sender_id, receiver_id, panel_id, gift_type, gift_value) VALUES (?, ?, ?, ?, ?)').run(req.user.id, receiver_id, panel_id, gift_type, gift.value);

  res.json({ success: true, remaining_coins: sender.coins - gift.value });
});

// Get gift shop
app.get('/api/gifts/shop', (req, res) => {
  res.json({ gifts: GIFT_TYPES });
});

// ============ USER ROUTES ============

// Get profile
app.get('/api/users/:id', (req, res) => {
  const user = db.prepare('SELECT id, username, email, avatar, bio, coins, diamonds, level, followers, following, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// Update profile
app.put('/api/users/profile', authenticateToken, (req, res) => {
  const { username, bio, avatar } = req.body;
  db.prepare('UPDATE users SET username = COALESCE(?, username), bio = COALESCE(?, bio), avatar = COALESCE(?, avatar) WHERE id = ?').run(username, bio, avatar, req.user.id);
  res.json({ success: true });
});

// Follow user
app.post('/api/users/:id/follow', authenticateToken, (req, res) => {
  try {
    db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(req.user.id, req.params.id);
    db.prepare('UPDATE users SET followers = followers + 1 WHERE id = ?').run(req.params.id);
    db.prepare('UPDATE users SET following = following + 1 WHERE id = ?').run(req.user.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: 'Already following' });
  }
});

// Buy coins
app.post('/api/wallet/buy-coins', authenticateToken, (req, res) => {
  const { amount } = req.body;
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(amount || 100, req.user.id);
  const user = db.prepare('SELECT coins, diamonds FROM users WHERE id = ?').get(req.user.id);
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
    db.prepare('UPDATE panels SET listeners = listeners + 1 WHERE id = ?').run(panelId);
    io.to(`panel-${panelId}`).emit('user-joined', { userId, username, socketId: socket.id });
  });

  socket.on('leave-panel', (data) => {
    const { panelId, userId, username } = data;
    socket.leave(`panel-${panelId}`);
    db.prepare('UPDATE panels SET listeners = MAX(0, listeners - 1) WHERE id = ?').run(panelId);
    io.to(`panel-${panelId}`).emit('user-left', { userId, username });
  });

  socket.on('send-message', (data) => {
    const { panelId, userId, username, content } = data;
    db.prepare('INSERT INTO messages (panel_id, user_id, username, content) VALUES (?, ?, ?, ?)').run(panelId, userId, username, content);
    io.to(`panel-${panelId}`).emit('new-message', { userId, username, content, timestamp: new Date().toISOString() });
  });

  socket.on('send-gift', (data) => {
    const { panelId, senderId, senderName, receiverId, giftType } = data;
    io.to(`panel-${panelId}`).emit('gift-received', { senderId, senderName, receiverId, giftType });
  });

  // WebRTC signaling
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
server.listen(PORT, () => {
  console.log(`Africa Live API running on port ${PORT}`);
  console.log(`WebSocket server ready`);
});
