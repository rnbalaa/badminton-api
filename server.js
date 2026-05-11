const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ===== IN-MEMORY STORE (reset on server restart) =====
const voters = {};       // token -> { name, isAdmin }
const claimedNames = {}; // name -> token (prevents duplicates)

// ===== ADMIN: Seed the voter name list (run once) =====
const VALID_NAMES = [
  'Ashwin', 'BalaRN', 'Bala Nagaraj', 'Dilee', 'Guru1',
  'Guru2', 'Guru4', 'Gundu Rao', 'Lucky', 'Manju',
  'Mohan', 'Prashant Steinbach', 'Prashant Konigstein', 'Pradeep', 'Shivanna',
  'Suhas', 'Vedha', 'Viraj', 'Vishwas', 'Venky', 'Vinay', 'Dummy22',
  'Dummy23', 'Dummy24', 'Dummy25'
];

app.use(express.static('public'));

// ===== ENDPOINTS =====

// GET available names (not yet claimed)
app.get('/available-names', (req, res) => {
  const available = VALID_NAMES.filter(name => !claimedNames[name]);
  res.json({ available, total: VALID_NAMES.length, claimed: Object.keys(claimedNames).length });
});

// POST /register – claim a name
app.post('/register', (req, res) => {
  const { name } = req.body;
  if (!name || !VALID_NAMES.includes(name)) {
    return res.status(400).json({ error: 'Invalid name.' });
  }
  if (claimedNames[name]) {
    return res.status(409).json({ error: 'Name already claimed.' });
  }
  // Create voter token
  const token = crypto.randomUUID();
  voters[token] = { name, isAdmin: false };
  claimedNames[name] = token;
  
  console.log(`✅ ${name} registered with token ${token.slice(0,8)}...`);
  res.json({ token, name });
});

// GET /voter – verify token and return name
app.get('/voter', (req, res) => {
  const token = req.query.token;
  if (!token || !voters[token]) {
    return res.status(401).json({ error: 'Invalid or missing token.' });
  }
  res.json({ name: voters[token].name });
});

// GET / – health check
app.get('/', (req, res) => {
  res.json({ status: 'Badminton Poll API v0.1', voters: Object.keys(voters).length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏸 Poll API running on port ${PORT}`);
  console.log(`📋 ${VALID_NAMES.length} names pre-loaded.`);
});