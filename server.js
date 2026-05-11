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

let currentPoll = null; // the active poll object

// ===== ADMIN: Seed the voter name list (run once) =====
const VALID_NAMES = [
  'Ashwin', 'BalaRN', 'Bala Nagaraj', 'Dilee', 'Guru1',
  'Guru2', 'Guru4', 'Gundu Rao', 'Lucky', 'Manju',
  'Mohan', 'Prashant Steinbach', 'Prashant Konigstein', 'Pradeep', 'Shivanna',
  'Suhas', 'Vedha', 'Viraj', 'Vishwas', 'Venky', 'Vinay', 'Dummy22',
  'Dummy23', 'Dummy24', 'Dummy25'
];

const ADMIN_KEY = 'bundbppgmbh';

app.use(express.static('public'));

// ✅ AUTO-CREATE A DEFAULT POLL ON STARTUP (for testing)
currentPoll = {
  title: 'Test Poll (auto-created)',
  capacity: 8,
  spots: []
};
console.log(`📋 Default poll created: "${currentPoll.title}" (capacity ${currentPoll.capacity})`);

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

// ==================== POLLING (v0.2) ====================



// POST /create-poll — admin only
app.post('/create-poll', (req, res) => {
  const { adminKey, title, capacity } = req.body;
  if (adminKey !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key.' });
  }
  if (!title || !capacity || capacity < 1) {
    return res.status(400).json({ error: 'Title and capacity (≥1) are required.' });
  }
  // If a poll already exists, we could overwrite it, but for now we replace it
  currentPoll = {
    title: title,
    capacity: capacity,
    spots: []  // each spot: { voterToken, voterName, claimedAt, cancelledAt }
  };
  console.log(`📋 Poll created: "${title}" (capacity ${capacity})`);
  res.json({ success: true, poll: currentPoll });
});

// GET /current-poll — anyone can fetch the active poll
app.get('/current-poll', (req, res) => {
  if (!currentPoll) {
    return res.json({ exists: false });
  }
  // Return the poll without exposing voter tokens
  res.json({
    exists: true,
    title: currentPoll.title,
    capacity: currentPoll.capacity,
    spots: currentPoll.spots.map(s => ({
      name: s.voterName,
      claimedAt: s.claimedAt,
      cancelled: !!s.cancelledAt
    }))
  });
});

// POST /claim-spot — a registered voter claims a spot
app.post('/claim-spot', (req, res) => {
  const { token } = req.body;
  if (!currentPoll) {
    return res.status(400).json({ error: 'No active poll.' });
  }
  // Verify voter
  if (!token || !voters[token]) {
    return res.status(401).json({ error: 'Invalid or missing token.' });
  }
  const voter = voters[token];
  // Check if already claimed (and not cancelled)
  const existing = currentPoll.spots.find(s => s.voterToken === token && !s.cancelledAt);
  if (existing) {
    return res.status(409).json({ error: 'You already claimed a spot.' });
  }
  // 🚫 NEW: Block if voter has already cancelled this week
  const cancelledSpot = currentPoll.spots.find(s => s.voterToken === token && s.cancelledAt);
  if (cancelledSpot) {
    return res.status(403).json({ error: 'You have already cancelled your spot and cannot reclaim this week.' });
  }
  // Add new spot
  const spot = {
    voterToken: token,
    voterName: voter.name,
    claimedAt: new Date().toISOString(),
    cancelledAt: null
  };
  currentPoll.spots.push(spot);
  console.log(`✅ ${voter.name} claimed a spot`);
  res.json({ success: true, spot });
});

// POST /cancel-spot — voter cancels their own spot
app.post('/cancel-spot', (req, res) => {
  const { token } = req.body;
  if (!currentPoll) {
    return res.status(400).json({ error: 'No active poll.' });
  }
  if (!token || !voters[token]) {
    return res.status(401).json({ error: 'Invalid or missing token.' });
  }
  const spot = currentPoll.spots.find(s => s.voterToken === token && !s.cancelledAt);
  if (!spot) {
    return res.status(404).json({ error: 'You have no active spot to cancel.' });
  }
  spot.cancelledAt = new Date().toISOString();
  console.log(`❌ ${spot.voterName} cancelled their spot`);
  res.json({ success: true, spot });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏸 Poll API running on port ${PORT}`);
  console.log(`📋 ${VALID_NAMES.length} names pre-loaded.`);
});