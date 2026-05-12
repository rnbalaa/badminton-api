const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ===== IN-MEMORY STORE =====
const voters = {};
const claimedNames = {};
let currentPoll = null;

const VALID_NAMES = [
  'Ashwin', 'BalaRN', 'Bala Nagaraj', 'Dilee', 'Guru1',
  'Guru2', 'Guru4', 'Gundu Rao', 'Lucky', 'Manju',
  'Mohan', 'Prashant Steinbach', 'Prashant Konigstein', 'Pradeep', 'Shivanna',
  'Suhas', 'Vedha', 'Viraj', 'Vishwas', 'Venky', 'Vinay', 'Dummy22',
  'Dummy23', 'Dummy24', 'Dummy25',
  'Test1','Test2','Test3','Test4','Test5','Test6','Test7','Test8',
  'Test9','Test10','CancelTest',
];

const ADMIN_KEY = 'bundbppgmbh';
// Serve the combined page at root
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});
app.use(express.static('public'));

currentPoll = {
  title: 'Test Poll (auto-created)',
  capacity: 8,
  spots: []
};

// ===== ENDPOINTS =====

app.get('/available-names', (req, res) => {
  const available = VALID_NAMES.filter(name => !claimedNames[name]);
  res.json({ available, total: VALID_NAMES.length, claimed: Object.keys(claimedNames).length });
});

app.post('/register', (req, res) => {
  const { name } = req.body;
  if (!name || !VALID_NAMES.includes(name)) return res.status(400).json({ error: 'Invalid name.' });
  if (claimedNames[name]) return res.status(409).json({ error: 'Name already claimed.' });
  const token = crypto.randomUUID();
  voters[token] = { name, isAdmin: false };
  claimedNames[name] = token;
  res.json({ token, name });
});

app.get('/voter', (req, res) => {
  const token = req.query.token;
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid or missing token.' });
  res.json({ name: voters[token].name });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'Badminton Poll API v0.1', voters: Object.keys(voters).length });
});


// ==================== POLLING ====================

app.post('/create-poll', (req, res) => {
  const { adminKey, title, capacity } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key.' });
  if (!title || !capacity || capacity < 1) return res.status(400).json({ error: 'Title and capacity (≥1) are required.' });
  currentPoll = { title, capacity, spots: [] };
  res.json({ success: true, poll: currentPoll });
});

app.get('/current-poll', (req, res) => {
  if (!currentPoll) return res.json({ exists: false });
  res.json({
    exists: true,
    title: currentPoll.title,
    capacity: currentPoll.capacity,
    spots: currentPoll.spots.map(s => ({
      name: s.voterName,
      claimedAt: s.claimedAt,
      cancelled: !!s.cancelledAt,
      cancelledAt: s.cancelledAt || null
    }))
  });
});

// 🔍 NEW: Check YOUR spot status
app.get('/my-spot', (req, res) => {
  const token = req.query.token;
  if (!currentPoll) return res.json({ hasSpot: false, reason: 'no-poll' });
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid token.' });
  
  const active = currentPoll.spots.find(s => s.voterToken === token && !s.cancelledAt);
  const cancelled = currentPoll.spots.find(s => s.voterToken === token && s.cancelledAt);
  
  if (active) return res.json({ hasSpot: true, status: 'active', name: active.voterName, claimedAt: active.claimedAt });
  if (cancelled) return res.json({ hasSpot: true, status: 'cancelled', name: cancelled.voterName, cancelledAt: cancelled.cancelledAt });
  return res.json({ hasSpot: false, status: 'none' });
});

app.post('/claim-spot', (req, res) => {
  const { token } = req.body;
  if (!currentPoll) return res.status(400).json({ error: 'No active poll.' });
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid or missing token.' });
  
  const voter = voters[token];
  if (currentPoll.spots.find(s => s.voterToken === token && !s.cancelledAt)) {
    return res.status(409).json({ error: 'You already claimed a spot.' });
  }
  if (currentPoll.spots.find(s => s.voterToken === token && s.cancelledAt)) {
    return res.status(403).json({ error: 'You have already cancelled and cannot reclaim.' });
  }
  
  const spot = { voterToken: token, voterName: voter.name, claimedAt: new Date().toISOString(), cancelledAt: null };
  currentPoll.spots.push(spot);
  res.json({ success: true, spot });
});

app.post('/cancel-spot', (req, res) => {
  const { token } = req.body;
  if (!currentPoll) return res.status(400).json({ error: 'No active poll.' });
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid or missing token.' });
  
  const spot = currentPoll.spots.find(s => s.voterToken === token && !s.cancelledAt);
  if (!spot) return res.status(404).json({ error: 'You have no active spot to cancel.' });
  spot.cancelledAt = new Date().toISOString();
  res.json({ success: true, spot });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏸 Poll API running on port ${PORT}`));