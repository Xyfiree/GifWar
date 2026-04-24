require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

// ─── Room storage ────────────────────────────────────────────────────────────
const rooms = new Map();
const timers = new Map();

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function clearTimer(key) {
  if (timers.has(key)) {
    clearTimeout(timers.get(key));
    timers.delete(key);
  }
}

// ─── Giphy proxy (hides API key) ─────────────────────────────────────────────
app.get('/api/giphy', async (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) return res.json({ data: [] });
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${process.env.GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13&lang=fr`;
    const r = await fetch(url);
    const json = await r.json();
    const data = (json.data || []).map(g => ({
      id: g.id,
      url: g.images.fixed_height.url,
      preview: g.images.fixed_height_small?.url || g.images.fixed_height.url,
      title: g.title
    }));
    res.json({ data });
  } catch (e) {
    console.error('Giphy error:', e.message);
    res.json({ data: [] });
  }
});

// ─── Gemini helper ───────────────────────────────────────────────────────────
async function callGemini(prompt) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    }
  );
  const data = await r.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

const FALLBACK_CONVOS = [
  "🧑 A : frère j'ai dormi 14h\n🧑 B : t'es guéri ?\n🧑 A : nan j'suis encore fatigué",
  "🧑 A : je commence mon régime lundi\n🧑 B : t'as dit ça le lundi dernier\n🧑 A : ouais bah lundi prochain alors",
  "🧑 A : t'as révisé ?\n🧑 B : j'ai regardé le cours 2 minutes\n🧑 A : t'es prêt\n🧑 B : je suis prêt",
  "🧑 A : je vais me coucher tôt ce soir\n🧑 B : il est 3h du mat\n🧑 A : ouais c'est tôt",
  "🧑 A : j'ai quelque chose d'important à te dire\n🧑 B : quoi ??\n🧑 A : ...j'sais plus",
];

const FALLBACK_PHRASES = [
  "Toi quand le prof dit 'on va rester 5 minutes de plus' 💀",
  "Quand tu check ton compte en banque après le weekend 😭",
  "Toi quand quelqu'un mange bruyamment à côté de toi 😤",
  "Quand le Wi-Fi coupe pendant le meilleur moment du film 🤬",
  "Toi quand tu entends ton prénom dans une convo privée 👁️",
];

async function generateConversation() {
  try {
    const text = await callGemini(
      `Tu génères des prompts ultra drôles et "brainrot" pour un jeu de GIFs entre potes.
Style : humour gen Z français, absurde, relatable, un peu chaotique. Pense aux memes TikTok/Twitter FR.
Génère UNE courte conversation entre 2 personnes (3-4 répliques MAX), très drôle ou awkward.
Format EXACT (rien d'autre, pas d'intro, pas d'explication) :
🧑 A : [réplique]
🧑 B : [réplique]
🧑 A : [réplique]

Exemples de style :
🧑 A : frère j'ai dormi 14h
🧑 B : t'es guéri ?
🧑 A : nan j'suis encore fatigué

🧑 A : je commence mon régime lundi
🧑 B : t'as dit ça le lundi dernier
🧑 A : ouais bah lundi prochain alors

Génère une nouvelle conversation différente des exemples.`
    );
    if (!text || text.length < 20) throw new Error('empty');
    return text;
  } catch (e) {
    console.error('Gemini conversation error:', e.message);
    return FALLBACK_CONVOS[Math.floor(Math.random() * FALLBACK_CONVOS.length)];
  }
}

async function generatePhrase() {
  try {
    const text = await callGemini(
      `Tu génères des prompts ultra drôles et "brainrot" pour un jeu de GIFs entre potes.
Style : humour gen Z français, absurde, relatable, chaos energy. Pense memes TikTok/Twitter FR.
Génère UNE SEULE phrase de situation (type "Toi quand..." ou "Quand...").
Ajoute 1-2 emojis. Sois inventif, absurde, drôle. PAS de guillemets, PAS d'intro, juste la phrase.

Exemples de style :
- Toi quand le prof dit "on va rester 5 minutes de plus" 💀
- Quand tu check ton compte en banque après le weekend 😭
- Toi quand tu entends ton prénom dans une convo que t'étais pas censé entendre 👁️
- Quand t'as menti sur ton CV et ils te demandent de le faire en vrai 😰

Génère une nouvelle phrase différente des exemples.`
    );
    const line = text.split('\n').find(l => l.trim().length > 10) || '';
    if (!line) throw new Error('empty');
    return line.trim().replace(/^[-•*]\s*/, '').replace(/^["']|["']$/g, '');
  } catch (e) {
    console.error('Gemini phrase error:', e.message);
    return FALLBACK_PHRASES[Math.floor(Math.random() * FALLBACK_PHRASES.length)];
  }
}

// ─── Game flow ───────────────────────────────────────────────────────────────
async function startRound(code) {
  const room = rooms.get(code);
  if (!room) return;

  room.currentRound++;
  room.submissions = {};
  room.votes = {};
  room.state = 'playing';

  const prompt = room.settings.mode === 1
    ? await generateConversation()
    : await generatePhrase();

  room.currentPrompt = prompt;

  io.to(code).emit('round-started', {
    round: room.currentRound,
    totalRounds: room.settings.rounds,
    prompt,
    mode: room.settings.mode,
    timer: room.settings.timer
  });

  if (room.settings.timer) {
    const t = setTimeout(() => {
      const r = rooms.get(code);
      if (r && r.state === 'playing' && r.currentRound === room.currentRound) {
        startVoting(code);
      }
    }, room.settings.timer * 1000);
    timers.set(code + '_submit', t);
  }
}

function startVoting(code) {
  const room = rooms.get(code);
  if (!room || room.state !== 'playing') return;
  clearTimer(code + '_submit');

  const submissionEntries = Object.entries(room.submissions);
  if (submissionEntries.length === 0) {
    io.to(code).emit('no-submissions');
    const t = setTimeout(() => {
      const r = rooms.get(code);
      if (!r) return;
      if (r.currentRound >= r.settings.rounds) {
        io.to(code).emit('game-over', { finalScores: sortedScores(r) });
        r.state = 'lobby';
      } else {
        startRound(code);
      }
    }, 3000);
    timers.set(code + '_next', t);
    return;
  }

  room.state = 'voting';

  const submissions = submissionEntries
    .map(([id, gif]) => ({ submissionId: id, gif }))
    .sort(() => Math.random() - 0.5);

  io.to(code).emit('voting-started', {
    submissions,
    prompt: room.currentPrompt,
    mode: room.settings.mode
  });

  // 30s voting timer
  const t = setTimeout(() => {
    const r = rooms.get(code);
    if (r && r.state === 'voting') endVoting(code);
  }, 30000);
  timers.set(code + '_vote', t);
}

function endVoting(code) {
  const room = rooms.get(code);
  if (!room || room.state !== 'voting') return;
  clearTimer(code + '_vote');
  room.state = 'results';

  // Count votes
  const voteCount = {};
  Object.keys(room.submissions).forEach(id => { voteCount[id] = 0; });
  Object.values(room.votes).forEach(votedId => {
    if (voteCount[votedId] !== undefined) voteCount[votedId]++;
  });

  const maxVotes = Math.max(...Object.values(voteCount), 0);
  const winners = maxVotes > 0
    ? Object.entries(voteCount).filter(([, v]) => v === maxVotes).map(([id]) => id)
    : [];

  // Points
  const pts = {};
  room.players.forEach(p => { pts[p.id] = 0; });

  Object.entries(voteCount).forEach(([id, votes]) => {
    if (pts[id] !== undefined) pts[id] += votes * 2;
  });
  Object.entries(room.votes).forEach(([voterId, votedId]) => {
    if (winners.includes(votedId) && pts[voterId] !== undefined) pts[voterId] += 1;
  });

  room.players.forEach(p => { p.score += pts[p.id] || 0; });

  const results = room.players.map(p => ({
    id: p.id,
    username: p.username,
    score: p.score,
    pointsEarned: pts[p.id] || 0,
    votesReceived: voteCount[p.id] || 0,
    gif: room.submissions[p.id] || null,
    isWinner: winners.includes(p.id)
  })).sort((a, b) => b.score - a.score);

  io.to(code).emit('round-results', {
    results,
    round: room.currentRound,
    totalRounds: room.settings.rounds
  });

  const t = setTimeout(() => {
    const r = rooms.get(code);
    if (!r) return;
    if (r.currentRound >= r.settings.rounds) {
      io.to(code).emit('game-over', { finalScores: sortedScores(r) });
      r.state = 'lobby';
    } else {
      startRound(code);
    }
  }, 10000);
  timers.set(code + '_next', t);
}

function sortedScores(room) {
  return [...room.players].sort((a, b) => b.score - a.score);
}

function checkAutoAdvance(room, code) {
  if (!room) return;
  if (room.state === 'playing') {
    const submitted = Object.keys(room.submissions).length;
    if (submitted >= room.players.length && room.players.length > 0) {
      clearTimer(code + '_submit');
      startVoting(code);
    }
  } else if (room.state === 'voting') {
    const voted = Object.keys(room.votes).length;
    if (voted >= room.players.length && room.players.length > 0) {
      clearTimer(code + '_vote');
      endVoting(code);
    }
  }
}

// ─── Socket events ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('create-room', ({ username, mode, rounds, timer }) => {
    if (!username?.trim()) return socket.emit('error', 'Pseudo requis.');
    const code = generateCode();
    const room = {
      code,
      host: socket.id,
      players: [{ id: socket.id, username: username.trim(), score: 0 }],
      settings: {
        mode: parseInt(mode) || 1,
        rounds: parseInt(rounds) || 5,
        timer: timer ? 60 : null
      },
      state: 'lobby',
      currentRound: 0,
      currentPrompt: null,
      submissions: {},
      votes: {}
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.code = code;
    socket.emit('room-created', {
      code,
      isHost: true,
      players: room.players,
      settings: room.settings
    });
  });

  socket.on('join-room', ({ code, username }) => {
    const uname = username?.trim();
    if (!uname) return socket.emit('error', 'Pseudo requis.');
    const room = rooms.get(code?.toUpperCase());
    if (!room) return socket.emit('error', 'Salon introuvable. Vérifie le code.');
    if (room.state !== 'lobby') return socket.emit('error', 'La partie a déjà commencé !');
    if (room.players.length >= 8) return socket.emit('error', 'Salon complet (max 8 joueurs).');
    if (room.players.find(p => p.username.toLowerCase() === uname.toLowerCase()))
      return socket.emit('error', 'Ce pseudo est déjà pris !');

    room.players.push({ id: socket.id, username: uname, score: 0 });
    socket.join(code.toUpperCase());
    socket.data.code = code.toUpperCase();

    socket.emit('room-joined', {
      code: code.toUpperCase(),
      isHost: false,
      players: room.players,
      settings: room.settings
    });
    socket.to(code.toUpperCase()).emit('player-list-updated', room.players);
  });

  socket.on('update-settings', ({ mode, rounds, timer }) => {
    const code = socket.data.code;
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    room.settings = {
      mode: parseInt(mode) || 1,
      rounds: parseInt(rounds) || 5,
      timer: timer ? 60 : null
    };
    io.to(code).emit('settings-updated', room.settings);
  });

  socket.on('start-game', () => {
    const code = socket.data.code;
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error', 'Il faut au moins 2 joueurs !');
    room.players.forEach(p => { p.score = 0; });
    room.currentRound = 0;
    io.to(code).emit('game-started');
    startRound(code);
  });

  socket.on('submit-gif', ({ gif }) => {
    const code = socket.data.code;
    const room = rooms.get(code);
    if (!room || room.state !== 'playing') return;
    if (room.submissions[socket.id]) return; // already submitted

    room.submissions[socket.id] = gif;
    const submitted = Object.keys(room.submissions).length;
    io.to(code).emit('submission-update', { submitted, total: room.players.length });

    if (submitted >= room.players.length) {
      clearTimer(code + '_submit');
      startVoting(code);
    }
  });

  socket.on('submit-vote', ({ votedForId }) => {
    const code = socket.data.code;
    const room = rooms.get(code);
    if (!room || room.state !== 'voting') return;
    if (socket.id === votedForId) return;
    if (room.votes[socket.id]) return; // already voted
    if (!room.submissions[votedForId]) return; // invalid target

    room.votes[socket.id] = votedForId;
    const voted = Object.keys(room.votes).length;
    io.to(code).emit('vote-update', { voted, total: room.players.length });

    if (voted >= room.players.length) {
      clearTimer(code + '_vote');
      endVoting(code);
    }
  });

  socket.on('play-again', () => {
    const code = socket.data.code;
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;
    clearTimer(code + '_submit');
    clearTimer(code + '_vote');
    clearTimer(code + '_next');
    room.state = 'lobby';
    room.currentRound = 0;
    room.submissions = {};
    room.votes = {};
    room.players.forEach(p => { p.score = 0; });
    io.to(code).emit('back-to-lobby', { players: room.players, settings: room.settings, isHost: false });
    socket.emit('back-to-lobby', { players: room.players, settings: room.settings, isHost: true });
  });

  socket.on('disconnect', () => {
    const code = socket.data?.code;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.submissions[socket.id];
    delete room.votes[socket.id];

    if (room.players.length === 0) {
      clearTimer(code + '_submit');
      clearTimer(code + '_vote');
      clearTimer(code + '_next');
      rooms.delete(code);
      return;
    }

    if (room.host === socket.id) {
      room.host = room.players[0].id;
      io.to(code).emit('new-host', { hostId: room.players[0].id });
    }

    io.to(code).emit('player-list-updated', room.players);
    checkAutoAdvance(room, code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🎮 GifWar running → http://localhost:${PORT}`));

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => process.exit(0));
});
