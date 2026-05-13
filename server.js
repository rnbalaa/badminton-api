const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();
const VERSION = '0.5.1';
const COUNTER_FILE = path.join(__dirname, 'counter.json');

// Persistent counter
let visitCounter = 0;
try {
  const data = fs.readFileSync(COUNTER_FILE, 'utf8');
  visitCounter = JSON.parse(data).count || 0;
  console.log(`📊 Visit counter loaded: ${visitCounter}`);
} catch (err) {
  visitCounter = 0;
}

function saveCounter() {
  try {
    fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count: visitCounter }), 'utf8');
  } catch (err) {
    console.error('Could not save counter:', err.message);
  }
}

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
  'Test1','Test2','Test3','Test4','Test5','Test6','Test7','Test8','Test9','Test10','CancelTest',
  'Guest01','Guest02','Guest03','Guest04'
];

const ADMIN_KEY = 'bundbppgmbh';
const MAX_RECLAIMS = 3;

app.use(express.static('public'));

currentPoll = {
  title: 'Test Poll (auto-created)',
  capacity: 8,
  spots: []
};

// ===== ENDPOINTS =====

// Root: serve page + increment counter
app.get('/', (req, res) => {
  visitCounter++;
  saveCounter();
  res.sendFile(__dirname + '/public/index.html');
});

// Counter read
app.get('/counter', (req, res) => {
  res.json({ count: visitCounter });
});

app.get('/available-names', (req, res) => {
  const available = VALID_NAMES.filter(name => !claimedNames[name]);
  res.json({ available, total: VALID_NAMES.length, claimed: Object.keys(claimedNames).length });
});

app.post('/register', (req, res) => {
  const { name } = req.body;
  if (!name || !VALID_NAMES.includes(name)) return res.status(400).json({ error: 'Invalid name.' });
  if (claimedNames[name]) return res.status(409).json({ error: 'Name already claimed.' });
  const token = crypto.randomUUID();
  voters[token] = { name, isAdmin: false, reclaimCount: 0, passcode: null };
  claimedNames[name] = token;
  res.json({ token, name });
});

app.get('/voter', (req, res) => {
  const token = req.query.token;
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid or missing token.' });
  res.json({ name: voters[token].name });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'Badminton Poll API', version: VERSION, voters: Object.keys(voters).length });
});

// ==================== POLLING ====================

function resetReclaimCounters() {
  for (const token in voters) {
    voters[token].reclaimCount = 0;
  }
}

app.post('/create-poll', (req, res) => {
  const { adminKey, title, capacity } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key.' });
  if (!title || !capacity || capacity < 1) return res.status(400).json({ error: 'Title and capacity (≥1) are required.' });
  currentPoll = { title, capacity, spots: [] };
  resetReclaimCounters();
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
      cancelledAt: s.cancelledAt || null,
      promoted: !!s.promoted,
      reclaimed: !!s.reclaimed
    }))
  });
});

app.get('/my-spot', (req, res) => {
  const token = req.query.token;
  if (!currentPoll) return res.json({ hasSpot: false, reason: 'no-poll' });
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid token.' });

  const active = currentPoll.spots.find(s => s.voterToken === token && !s.cancelledAt);
  const cancelled = currentPoll.spots.find(s => s.voterToken === token && s.cancelledAt);

  if (active) return res.json({ hasSpot: true, status: 'active', name: active.voterName, claimedAt: active.claimedAt });
  if (cancelled) {
    const voter = voters[token];
    return res.json({
      hasSpot: true,
      status: 'cancelled',
      name: cancelled.voterName,
      cancelledAt: cancelled.cancelledAt,
      reclaimCount: voter.reclaimCount,
      maxReclaims: MAX_RECLAIMS
    });
  }
  return res.json({ hasSpot: false, status: 'none' });
});

app.post('/claim-spot', (req, res) => {
  const { token } = req.body;
  if (!currentPoll) return res.status(400).json({ error: 'No active poll.' });
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid or missing token.' });

  const voter = voters[token];

  if (currentPoll.spots.find(s => s.voterToken === token && !s.cancelledAt)) {
    return res.status(409).json({ error: 'You already have an active spot.' });
  }

  const hasCancelledBefore = currentPoll.spots.some(s => s.voterToken === token && s.cancelledAt);
  if (hasCancelledBefore) {
    if (voter.reclaimCount >= MAX_RECLAIMS) {
      return res.status(403).json({ error: `You have reached the maximum of ${MAX_RECLAIMS} reclaims for this poll.` });
    }
    voter.reclaimCount++;
  }

  const spot = {
    voterToken: token,
    voterName: voter.name,
    claimedAt: new Date().toISOString(),
    cancelledAt: null,
    promoted: false,
    reclaimed: hasCancelledBefore
  };
  currentPoll.spots.push(spot);
  console.log(`✅ ${voter.name} claimed (reclaimed: ${hasCancelledBefore}, reclaims: ${voter.reclaimCount})`);
  res.json({ success: true, spot });
});

app.post('/cancel-spot', (req, res) => {
  const { token } = req.body;
  if (!currentPoll) return res.status(400).json({ error: 'No active poll.' });
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid or missing token.' });

  const spot = currentPoll.spots.find(s => s.voterToken === token && !s.cancelledAt);
  if (!spot) return res.status(404).json({ error: 'You have no active spot to cancel.' });
  spot.cancelledAt = new Date().toISOString();

  const activeSpots = currentPoll.spots.filter(s => !s.cancelledAt);
  const capacity = currentPoll.capacity;
  for (let i = 0; i < activeSpots.length; i++) {
    const s = activeSpots[i];
    if (i >= capacity && !s.promoted) {
      s.promoted = true;
      console.log(`⬆️ Promoted ${s.voterName} from waitlist`);
      break;
    }
  }
  res.json({ success: true, spot });
});

// ==================== ADMIN ENDPOINTS ====================

app.post('/admin/reset-all', (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key.' });
  for (const token in voters) delete voters[token];
  for (const name in claimedNames) delete claimedNames[name];
  currentPoll = { title: 'Test Poll (auto-created)', capacity: 8, spots: [] };
  console.log('🔄 Full reset performed');
  res.json({ success: true });
});

app.get('/admin/registered', (req, res) => {
  const adminKey = req.query.key;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key.' });
  const registered = Object.entries(voters).map(([token, info]) => ({
    name: info.name,
    isAdmin: info.isAdmin,
    reclaims: info.reclaimCount || 0,
    passcode: info.passcode
  }));
  registered.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ registered });
});

app.post('/admin/add-test-players', (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key.' });
  const testNames = ['TestPlayer1', 'TestPlayer2'];
  const added = [];
  for (const name of testNames) {
    if (claimedNames[name]) {
      added.push({ name, status: 'already exists' });
      continue;
    }
    const token = crypto.randomUUID();
    voters[token] = { name, isAdmin: false, reclaimCount: 0, passcode: null };
    claimedNames[name] = token;
    if (currentPoll) {
      currentPoll.spots.push({
        voterToken: token,
        voterName: name,
        claimedAt: new Date().toISOString(),
        cancelledAt: null,
        promoted: false,
        reclaimed: false
      });
    }
    added.push({ name, status: 'registered & claimed' });
  }
  res.json({ success: true, added });
});

app.post('/admin/remove-registration', (req, res) => {
  const { adminKey, name } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key.' });
  if (!name || !claimedNames[name]) return res.status(400).json({ error: 'Name not found.' });
  const token = claimedNames[name];
  delete voters[token];
  delete claimedNames[name];
  if (currentPoll) {
    currentPoll.spots = currentPoll.spots.filter(s => s.voterToken !== token);
  }
  console.log(`🗑️ Removed registration for ${name}`);
  res.json({ success: true });
});

app.post('/admin/add-names', (req, res) => {
  const { adminKey, names } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key.' });
  if (!names || typeof names !== 'string') return res.status(400).json({ error: 'Names string required.' });
  const nameList = names.split(',').map(n => n.trim()).filter(n => n);
  const added = [];
  for (const name of nameList) {
    if (!VALID_NAMES.includes(name)) {
      VALID_NAMES.push(name);
      added.push(name);
    }
  }
  console.log(`➕ Added names: ${added.join(', ')}`);
  res.json({ success: true, added });
});

app.get('/admin/passcodes', (req, res) => {
  const adminKey = req.query.key;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key.' });
  const passcodes = Object.entries(voters).map(([token, info]) => ({
    name: info.name,
    passcode: info.passcode || null
  }));
  passcodes.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ passcodes });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏸 Poll API v${VERSION} running on port ${PORT}`));