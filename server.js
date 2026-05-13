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
const voters = {};          // token -> { name, isAdmin, reclaimCount }
const claimedNames = {};    // name -> token
let currentPoll = null;

const VALID_NAMES = [
  'Ashwin', 'BalaRN', 'Bala Nagaraj', 'Dilee', 'Guru1',
  'Guru2', 'Guru4', 'Gundu Rao', 'Lucky', 'Manju',
  'Mohan', 'Prashant Steinbach', 'Prashant Konigstein', 'Pradeep', 'Shivanna',
  'Suhas', 'Vedha', 'Viraj', 'Vishwas', 'Venky', 'Vinay', 'Dummy22',
  'Dummy23', 'Dummy24', 'Dummy25',
  'Test1','Test2','Test3','Test4','Test5','Test6','Test7','Test8','Test9','Test10','CancelTest'
];

const ADMIN_KEY = 'bundbppgmbh';
const MAX_RECLAIMS = 3;   // after 3 reclaims, block further reclaims

app.use(express.static('public'));

// Auto‑create poll
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
  voters[token] = { name, isAdmin: false, reclaimCount: 0 };
  claimedNames[name] = token;
  res.json({ token, name });
});

app.get('/voter', (req, res) => {
  const token = req.query.token;
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid or missing token.' });
  res.json({ name: voters[token].name });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'Badminton Poll API v0.4', voters: Object.keys(voters).length });
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// ==================== POLLING ====================

// Helper to reset reclaim counters (called when a new poll is created)
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
  if (cancelled) return res.json({ hasSpot: true, status: 'cancelled', name: cancelled.voterName, cancelledAt: cancelled.cancelledAt });
  return res.json({ hasSpot: false, status: 'none' });
});

app.post('/claim-spot', (req, res) => {
  const { token } = req.body;
  if (!currentPoll) return res.status(400).json({ error: 'No active poll.' });
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid or missing token.' });

  const voter = voters[token];

  // Block if already holding an active spot
  if (currentPoll.spots.find(s => s.voterToken === token && !s.cancelledAt)) {
    return res.status(409).json({ error: 'You already have an active spot.' });
  }

  const hasCancelledBefore = currentPoll.spots.some(s => s.voterToken === token && s.cancelledAt);
  if (hasCancelledBefore) {
    // Re‑claim attempt – check limit
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
  console.log(`✅ ${voter.name} claimed (reclaimed: ${hasCancelledBefore}, total reclaims: ${voter.reclaimCount})`);
  res.json({ success: true, spot });
});

app.post('/cancel-spot', (req, res) => {
  const { token } = req.body;
  if (!currentPoll) return res.status(400).json({ error: 'No active poll.' });
  if (!token || !voters[token]) return res.status(401).json({ error: 'Invalid or missing token.' });

  const spot = currentPoll.spots.find(s => s.voterToken === token && !s.cancelledAt);
  if (!spot) return res.status(404).json({ error: 'You have no active spot to cancel.' });
  spot.cancelledAt = new Date().toISOString();

  // Promote first waitlisted player
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

// List registered players (read‑only)
app.get('/admin/registered', (req, res) => {
  const adminKey = req.query.key;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key.' });
  const registered = Object.entries(voters).map(([token, info]) => ({
    name: info.name,
    isAdmin: info.isAdmin,
    reclaims: info.reclaimCount || 0
  }));
  registered.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ registered });
});

// Add two test players (just register, no claim)
app.post('/admin/add-test-players', (req, res) => {
  const { adminKey } = req.body;
  if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key.' });
  const testNames = ['TestPlayer1', 'TestPlayer2'];
  const added = [];
  for (const name of testNames) {
    if (claimedNames[name]) {
      added.push({ name, status: 'already exists' });
    } else {
      const token = crypto.randomUUID();
      voters[token] = { name, isAdmin: false, reclaimCount: 0 };
      claimedNames[name] = token;
      added.push({ name, status: 'registered', token });
    }
  }
  res.json({ success: true, added });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏸 Poll API running on port ${PORT}`));