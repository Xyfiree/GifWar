/* ═══════════════════════════════════════════════════════════════
   GifWar — Client-side game logic
   ═══════════════════════════════════════════════════════════════ */

// ─── Background floating GIFs ─────────────────────────────────
const BG_QUERIES = ['reaction','funny','wow','no way','lol','bruh','what','omg','yes','dancing','cat','dog','fail','win','awkward'];
let bgGifPool = [];
let bgInterval = null;

async function loadBgGifs() {
  try {
    const q = BG_QUERIES[Math.floor(Math.random() * BG_QUERIES.length)];
    const res = await fetch('/api/giphy?q=' + q);
    const data = await res.json();
    if (data.data?.length) {
      bgGifPool = [...bgGifPool, ...data.data.map(g => g.url)].slice(0, 40);
    }
  } catch (e) { /* silent */ }
}

function spawnBgGif() {
  if (!bgGifPool.length) return;
  const container = document.getElementById('bg-gifs');
  if (!container) return;
  if (container.children.length >= 12) return;

  const url = bgGifPool[Math.floor(Math.random() * bgGifPool.length)];
  const size = Math.random() * 90 + 50;
  // Random position anywhere on screen
  const top = Math.random() * 90;
  const left = Math.random() * 90;
  const duration = Math.random() * 8 + 6;
  const rotStart = (Math.random() - 0.5) * 20;
  const rotEnd = rotStart + (Math.random() - 0.5) * 30;
  // Slight drift direction
  const dx = (Math.random() - 0.5) * 40 + 'px';
  const dy = (Math.random() - 0.5) * 40 + 'px';

  const img = document.createElement('img');
  img.className = 'bg-gif';
  img.src = url;
  img.style.cssText = `
    width: ${size}px;
    top: ${top}%;
    left: ${left}%;
    animation-duration: ${duration}s;
    --rot-start: ${rotStart}deg;
    --rot-end: ${rotEnd}deg;
    --dx: ${dx};
    --dy: ${dy};
  `;
  img.addEventListener('animationend', () => img.remove());
  container.appendChild(img);
}

function startBgGifs() {
  loadBgGifs();
  setTimeout(loadBgGifs, 5000);
  clearInterval(bgInterval);
  bgInterval = setInterval(spawnBgGif, 1800);
  spawnBgGif();
}

startBgGifs();

const socket = io();

// ─── State ────────────────────────────────────────────────────
const state = {
  username: '',
  roomCode: '',
  isHost: false,
  myId: null,
  players: [],
  settings: {},
  selectedGif: null,
  hasSubmitted: false,
  hasVoted: false,
  hasEgk: false,
  voteTimerInterval: null,
  submitTimerInterval: null,
};

// Player colors pool
const COLORS = ['#FF6B6B','#4ECDC4','#FFD700','#A29BFE','#FD79A8','#55EFC4','#FF9F43','#00B5FF'];

// ─── Screen management ────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + id);
  if (el) el.classList.add('active');
}

// ─── Toast ────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.classList.remove('show'), 3500);
}

// ─── Utils ───────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function setHidden(id, hidden) { el(id).classList.toggle('hidden', hidden); }
function getColor(index) { return COLORS[index % COLORS.length]; }

// ─── Render player list (lobby) ───────────────────────────────
function renderPlayers(players) {
  state.players = players;
  const list = el('lobby-player-list');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const tag = document.createElement('div');
    tag.className = 'player-tag';
    tag.style.background = getColor(i);
    tag.style.color = '#000';
    const dot = document.createElement('div');
    dot.className = 'player-dot';
    dot.style.background = '#000';
    dot.style.opacity = '0.3';
    tag.appendChild(dot);
    tag.appendChild(document.createTextNode(p.username));
    list.appendChild(tag);
  });
  el('player-count').textContent = players.length;
}

// ─── Render settings (guest view) ────────────────────────────
function renderGuestSettings(settings) {
  el('gs-mode').textContent = settings.mode === 1 ? '💬' : '📝';
  el('gs-rounds').textContent = settings.rounds;
  el('gs-timer').textContent = settings.timer ? '✅' : '❌';
  if (el('gs-prompt')) el('gs-prompt').textContent = settings.promptSource === 'players' ? '✍️' : '🤖';
}

// ─── GIF Search ───────────────────────────────────────────────
let searchTimeout;
async function searchGifs(query) {
  if (!query.trim()) return;
  const grid = el('gif-results');
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px"><div class="loading-dots" style="justify-content:center"><span></span><span></span><span></span></div></div>';

  try {
    const res = await fetch('/api/giphy?q=' + encodeURIComponent(query));
    const data = await res.json();

    grid.innerHTML = '';
    if (!data.data || data.data.length === 0) {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;opacity:0.5;font-weight:700">Aucun GIF trouvé 😢</p>';
      return;
    }

    data.data.forEach(gif => {
      const item = document.createElement('div');
      item.className = 'gif-item';
      item.dataset.id = gif.id;
      item.dataset.url = gif.url;
      item.dataset.title = gif.title;

      const img = document.createElement('img');
      img.src = gif.preview || gif.url;
      img.alt = gif.title;
      img.loading = 'lazy';

      item.appendChild(img);
      item.addEventListener('click', () => selectGif(gif, item));
      grid.appendChild(item);
    });
  } catch (e) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;opacity:0.5;font-weight:700">Erreur de recherche 😢</p>';
  }
}

function selectGif(gif, itemEl) {
  if (state.hasSubmitted) return;

  // Deselect all
  document.querySelectorAll('.gif-item').forEach(i => i.classList.remove('selected'));
  itemEl.classList.add('selected');

  state.selectedGif = gif;

  // Show preview
  el('selected-gif-img').src = gif.url;
  el('selected-gif-title').textContent = gif.title || 'GIF';
  el('selected-preview').classList.add('visible');

  // Enable submit
  el('btn-submit-gif').disabled = false;
}

// ─── Submit GIF ───────────────────────────────────────────────
function submitGif() {
  if (!state.selectedGif || state.hasSubmitted) return;

  state.hasSubmitted = true;
  socket.emit('submit-gif', { gif: state.selectedGif });

  // Show submitted state
  setHidden('gif-search-area', true);
  setHidden('selected-preview', true);
  setHidden('btn-submit-gif', true);
  setHidden('submitted-overlay', false);
  el('submitted-gif-preview').src = state.selectedGif.url;
}

// ─── Voting timer ─────────────────────────────────────────────
function startVoteTimer(seconds) {
  const ring = el('vote-ring');
  const num = el('vote-timer-num');
  const circumference = 188; // 2 * π * 30
  let remaining = seconds;

  ring.style.strokeDashoffset = 0;
  num.textContent = remaining;

  clearInterval(state.voteTimerInterval);
  state.voteTimerInterval = setInterval(() => {
    remaining--;
    num.textContent = remaining;

    const offset = circumference * (1 - remaining / seconds);
    ring.style.strokeDashoffset = offset;

    if (remaining <= 8) {
      ring.classList.add('urgent');
    }

    if (remaining <= 0) {
      clearInterval(state.voteTimerInterval);
    }
  }, 1000);
}

function stopVoteTimer() {
  clearInterval(state.voteTimerInterval);
}

// ─── Submit timer (game screen) ───────────────────────────────
function startSubmitTimer(seconds) {
  const timerEl = el('game-timer');
  setHidden('game-timer', false);
  let remaining = seconds;
  timerEl.textContent = '⏱ ' + remaining;

  clearInterval(state.submitTimerInterval);
  state.submitTimerInterval = setInterval(() => {
    remaining--;
    timerEl.textContent = '⏱ ' + remaining;
    if (remaining <= 10) timerEl.classList.add('urgent');
    if (remaining <= 0) clearInterval(state.submitTimerInterval);
  }, 1000);
}

// ─── Confetti ─────────────────────────────────────────────────
function spawnConfetti(count = 50) {
  const colors = ['#FFD700','#FF6B6B','#4ECDC4','#A29BFE','#FD79A8','#FF9F43'];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (Math.random() * 2 + 1.5) + 's';
    piece.style.animationDelay = (Math.random() * 0.5) + 's';
    piece.style.width = (Math.random() * 8 + 6) + 'px';
    piece.style.height = (Math.random() * 8 + 6) + 'px';
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}

// ─── Render round results ─────────────────────────────────────
function renderResults(results, round, totalRounds) {
  el('results-round-label').textContent = `Manche ${round} / ${totalRounds}`;
  const list = el('results-list');
  list.innerHTML = '';

  results.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'result-item' + (r.isWinner ? ' winner' : '');
    item.style.animationDelay = (i * 0.12) + 's';

    const rank = document.createElement('div');
    rank.className = 'result-rank';
    rank.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;

    let gifEl;
    if (r.gif) {
      gifEl = document.createElement('img');
      gifEl.className = 'result-gif';
      gifEl.src = r.gif.url;
      gifEl.alt = r.gif.title || '';
    } else {
      gifEl = document.createElement('div');
      gifEl.className = 'result-gif-empty';
      gifEl.textContent = '❓';
    }

    const info = document.createElement('div');
    info.className = 'result-info';
    info.innerHTML = `
      <div class="result-name">
        ${r.username}
        ${r.isWinner ? '<span class="crown">👑</span>' : ''}
        ${r.id === state.myId ? '<span style="font-size:0.7rem;background:var(--navy);color:white;padding:2px 8px;border-radius:50px">Toi</span>' : ''}
        ${r.egk > 0 ? `<span class="egk-badge">⭐ EGK x${r.egk}</span>` : ''}
      </div>
      <div class="result-votes">${r.votesReceived} vote${r.votesReceived !== 1 ? 's' : ''} reçu${r.votesReceived !== 1 ? 's' : ''}</div>
    `;

    const score = document.createElement('div');
    score.className = 'result-score';
    score.innerHTML = `
      <div class="pts-earned ${r.pointsEarned > 0 ? 'positive' : ''}">+${r.pointsEarned} pts</div>
      <div class="total-score">Total : ${r.score} pts</div>
    `;

    item.appendChild(rank);
    item.appendChild(gifEl);
    item.appendChild(info);
    item.appendChild(score);
    list.appendChild(item);
  });

  if (results[0]?.isWinner) spawnConfetti(40);
}

// ─── Render podium ────────────────────────────────────────────
function renderPodium(scores) {
  const podium = el('podium');
  const list = el('final-list');
  podium.innerHTML = '';
  list.innerHTML = '';

  const top3 = scores.slice(0, 3);
  const order = [1, 0, 2]; // silver, gold, bronze visual order

  order.forEach(rankIdx => {
    if (!top3[rankIdx]) return;
    const p = top3[rankIdx];
    const place = document.createElement('div');
    place.className = 'podium-place';
    place.innerHTML = `
      <div class="podium-block">
        <div class="podium-position">${rankIdx === 0 ? '🥇' : rankIdx === 1 ? '🥈' : '🥉'}</div>
        <div class="podium-name">${p.username}</div>
        <div class="podium-score">${p.score}pts</div>
      </div>
    `;
    podium.appendChild(place);
  });

  scores.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'final-item';
    item.style.animationDelay = (i * 0.1) + 's';
    item.innerHTML = `
      <div class="final-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`}</div>
      <div class="final-name">${p.username} ${p.id === state.myId ? '(toi)' : ''} ${(p.egk||0) > 0 ? `<span class="egk-badge">⭐ EGK x${p.egk}</span>` : ''}</div>
      <div class="final-score">${p.score} pts</div>
    `;
    list.appendChild(item);
  });

  spawnConfetti(80);
}

// ─── HOME SCREEN events ────────────────────────────────────────
el('btn-create-room').addEventListener('click', () => {
  const username = el('home-username').value.trim();
  if (!username) return showToast('Entre ton pseudo !');

  state.username = username;
  const mode = parseInt(el('setting-mode')?.value || 1);
  const rounds = parseInt(el('setting-rounds')?.value || 5);
  const timer = el('setting-timer')?.checked || false;

  socket.emit('create-room', { username, mode: 1, rounds: 5, timer: false });
});

el('btn-join-room').addEventListener('click', () => {
  const username = el('home-username').value.trim();
  const code = el('home-join-code').value.trim().toUpperCase();
  if (!username) return showToast('Entre ton pseudo !');
  if (!code || code.length < 4) return showToast('Entre le code de la salle !');

  state.username = username;
  socket.emit('join-room', { code, username });
});

el('home-join-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('btn-join-room').click();
});
el('home-username').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el('btn-create-room').click();
});

// ─── LOBBY events ──────────────────────────────────────────────
el('btn-start-game').addEventListener('click', () => {
  socket.emit('start-game');
});

// Settings change (host)
['setting-mode','setting-rounds','setting-timer','setting-prompt-source'].forEach(id => {
  const el_ = el(id);
  if (el_) {
    el_.addEventListener('change', () => {
      socket.emit('update-settings', {
        mode: parseInt(el('setting-mode').value),
        rounds: parseInt(el('setting-rounds').value),
        timer: el('setting-timer').checked,
        promptSource: el('setting-prompt-source').checked ? 'players' : 'ai'
      });
    });
  }
});

// ─── GAME events ───────────────────────────────────────────────
el('btn-search-gif').addEventListener('click', () => {
  searchGifs(el('gif-search-input').value);
});

el('gif-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchGifs(e.target.value);
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => searchGifs(e.target.value), 600);
});

el('btn-submit-gif').addEventListener('click', submitGif);

el('btn-submit-prompt').addEventListener('click', () => {
  const prompt = el('writing-input').value.trim();
  if (!prompt || prompt.length < 3) return showToast('Écris quelque chose !');
  socket.emit('submit-prompt', { prompt });
  el('btn-submit-prompt').disabled = true;
  el('btn-submit-prompt').textContent = '⏳ Envoyé...';
});

el('writing-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    el('btn-submit-prompt').click();
  }
});

// ─── GAME OVER events ──────────────────────────────────────────
el('btn-play-again').addEventListener('click', () => {
  socket.emit('play-again');
});

el('btn-home').addEventListener('click', () => {
  location.reload();
});

// ═══════════════════════════════════════════════════════════════
// SOCKET EVENTS
// ═══════════════════════════════════════════════════════════════

socket.on('connect', () => {
  state.myId = socket.id;
});

socket.on('error', (msg) => {
  showToast(msg);
});

// ─── Room created (host) ───────────────────────────────────────
socket.on('room-created', ({ code, isHost, players, settings }) => {
  state.roomCode = code;
  state.isHost = isHost;
  state.settings = settings;

  el('lobby-code').textContent = code;
  setHidden('host-settings', false);
  setHidden('guest-settings', true);
  setHidden('lobby-host-actions', false);
  setHidden('lobby-guest-waiting', true);

  renderPlayers(players);
  showScreen('lobby');
});

// ─── Room joined (guest) ───────────────────────────────────────
socket.on('room-joined', ({ code, isHost, players, settings }) => {
  state.roomCode = code;
  state.isHost = isHost;
  state.settings = settings;

  el('lobby-code').textContent = code;
  setHidden('host-settings', true);
  setHidden('guest-settings', false);
  setHidden('lobby-host-actions', true);
  setHidden('lobby-guest-waiting', false);

  renderPlayers(players);
  renderGuestSettings(settings);
  showScreen('lobby');
});

socket.on('player-list-updated', (players) => {
  renderPlayers(players);
});

socket.on('settings-updated', (settings) => {
  state.settings = settings;
  if (!state.isHost) renderGuestSettings(settings);
});

socket.on('new-host', ({ hostId }) => {
  if (hostId === socket.id) {
    state.isHost = true;
    setHidden('host-settings', false);
    setHidden('guest-settings', true);
    setHidden('lobby-host-actions', false);
    setHidden('lobby-guest-waiting', true);
    showToast('Tu es maintenant l\'hôte de la partie !');
  }
});

// ─── Game started ──────────────────────────────────────────────
socket.on('game-started', () => {
  state.selectedGif = null;
  state.hasSubmitted = false;
  state.hasVoted = false;
  state.hasEgk = false;
});

// ─── Round started ─────────────────────────────────────────────
socket.on('round-started', ({ round, totalRounds, prompt, mode, timer }) => {
  state.selectedGif = null;
  state.hasSubmitted = false;
  state.hasVoted = false;
  state.hasEgk = false;

  // Update UI
  el('game-round-label').textContent = `Manche ${round}/${totalRounds}`;
  el('game-mode-badge').textContent = mode === 1 ? 'MODE 1 — CONVERSATION' : 'MODE 2 — SITUATION';

  const promptEl = el('game-prompt-text');
  promptEl.className = 'prompt-text' + (mode === 2 ? ' phrase' : '');
  promptEl.textContent = prompt;

  // Reset submit area
  setHidden('submitted-overlay', true);
  setHidden('gif-search-area', false);
  setHidden('selected-preview', false);
  setHidden('btn-submit-gif', false);
  el('selected-preview').classList.remove('visible');
  el('btn-submit-gif').disabled = true;
  el('gif-results').innerHTML = '';
  el('gif-search-input').value = '';
  el('submission-count').textContent = '0';
  el('submission-total').textContent = state.players.length;
  el('game-timer').classList.remove('urgent');
  setHidden('game-timer', true);

  clearInterval(state.submitTimerInterval);
  if (timer) startSubmitTimer(timer);

  showScreen('game');
});

socket.on('submission-update', ({ submitted, total }) => {
  el('submission-count').textContent = submitted;
  el('submission-total').textContent = total;
});

// ─── Voting started ────────────────────────────────────────────
socket.on('voting-started', ({ submissions, prompt, mode }) => {
  state.hasVoted = false;
  state.hasEgk = false;
  stopVoteTimer();
  clearInterval(state.submitTimerInterval);

  const promptEl = el('vote-prompt-display');
  promptEl.textContent = prompt;
  promptEl.style.fontFamily = mode === 2 ? "'Fredoka One', cursive" : "'Nunito', sans-serif";
  promptEl.style.fontSize = mode === 2 ? '1.3rem' : '1rem';

  const grid = el('gif-vote-grid');
  grid.innerHTML = '';
  setHidden('voted-waiting', true);
  setHidden('egk-used-msg', true);

  // Build EGK buttons (one per non-mine submission)
  const egkGrid = el('egk-grid');
  egkGrid.innerHTML = '';

  submissions.forEach(({ submissionId, gif }) => {
    const isMine = submissionId === socket.id;

    // Vote card
    const card = document.createElement('div');
    card.className = 'vote-card' + (isMine ? ' is-mine' : '');
    card.dataset.id = submissionId;

    const img = document.createElement('img');
    img.src = gif.url;
    img.alt = gif.title || '';

    const btn = document.createElement('button');
    btn.className = 'vote-btn';
    btn.textContent = isMine ? 'Ton GIF' : 'Voter pour ce GIF';
    btn.disabled = isMine;

    if (!isMine) {
      btn.addEventListener('click', () => {
        if (state.hasVoted) return;
        state.hasVoted = true;
        document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('voted-for'));
        card.classList.add('voted-for');
        socket.emit('submit-vote', { votedForId: submissionId });
        setHidden('voted-waiting', false);
      });

      // EGK button for this submission
      const egkBtn = document.createElement('button');
      egkBtn.className = 'egk-btn';
      egkBtn.dataset.target = submissionId;
      egkBtn.innerHTML = `⭐ EGK → GIF anonyme`;
      egkBtn.addEventListener('click', () => {
        if (state.hasEgk) return;
        state.hasEgk = true;
        socket.emit('award-egk', { targetId: submissionId });
        document.querySelectorAll('.egk-btn').forEach(b => b.classList.add('used'));
        setHidden('egk-used-msg', false);
      });
      egkGrid.appendChild(egkBtn);
    }

    card.appendChild(img);
    card.appendChild(btn);
    grid.appendChild(card);
  });

  startVoteTimer(30);
  showScreen('voting');
});

socket.on('vote-update', ({ voted, total }) => {
  el('vote-count').textContent = voted;
  el('vote-total').textContent = total;
});

socket.on('no-submissions', () => {
  showToast('Personne n\'a soumis de GIF — manche suivante !');
});

// ─── Writer turn (joueur choisi pour écrire) ───────────────────
socket.on('writer-turn', ({ round, totalRounds, mode }) => {
  el('writing-round-label').textContent = `Manche ${round}/${totalRounds}`;
  el('writing-mode-label').textContent = mode === 1 ? '💬 Écris une conversation' : '📝 Écris une situation';
  el('writing-input').value = '';
  el('btn-submit-prompt').disabled = false;
  el('btn-submit-prompt').textContent = '🚀 Envoyer la phrase !';
  if (mode === 1) {
    el('writing-input').placeholder = 'Ex: 🧑 A : t\'as révisé ?\n🧑 B : j\'ai regardé le cours 2 min\n🧑 A : t\'es prêt\n🧑 B : je suis prêt';
  } else {
    el('writing-input').placeholder = 'Ex: Toi quand tu reçois un "on peut parler ?" à 23h... 😰';
  }
  showScreen('writing');
});

// ─── Waiting for writer ────────────────────────────────────────
socket.on('waiting-for-writer', async ({ round, totalRounds, writerName }) => {
  el('writer-name-display').textContent = writerName;
  el('waiting-round-label').textContent = `Manche ${round}/${totalRounds}`;

  // Load trending GIFs to show while waiting
  const trendingGrid = el('trending-gifs');
  trendingGrid.innerHTML = '';
  try {
    const queries = ['trending reaction','viral meme 2024','funny gif'];
    const q = queries[Math.floor(Math.random() * queries.length)];
    const res = await fetch('/api/giphy?q=' + encodeURIComponent(q));
    const data = await res.json();
    (data.data || []).slice(0, 6).forEach(gif => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;flex-direction:column;gap:4px';

      const img = document.createElement('img');
      img.src = gif.url;
      img.alt = gif.title || '';

      const label = document.createElement('div');
      label.style.cssText = 'font-size:0.7rem;font-weight:700;color:rgba(255,255,255,0.6);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px';
      label.textContent = gif.title || '—';
      label.title = gif.title || '';

      wrapper.appendChild(img);
      wrapper.appendChild(label);
      trendingGrid.appendChild(wrapper);
    });
  } catch (e) { /* silent */ }

  showScreen('waiting-writer');
});

// ─── EGK confirmed (sender) ────────────────────────────────────
socket.on('egk-confirmed', ({ targetId }) => {
  document.querySelectorAll('.egk-btn').forEach(b => {
    b.classList.add('used');
    if (b.dataset.target === targetId) {
      b.innerHTML = '⭐ EGK attribué !';
    }
  });
});

// ─── EGK awarded (broadcast) ──────────────────────────────────
socket.on('egk-awarded', ({ fromId, targetId, targetName }) => {
  if (fromId !== socket.id) {
    showToast(`⭐ Quelqu'un a attribué un EGK à ${targetName} !`);
  }
  // Update EGK button label for target
  const btn = document.querySelector(`.egk-btn[data-target="${targetId}"]`);
  if (btn && fromId === socket.id) {
    btn.innerHTML = `⭐ EGK → ${targetName}`;
  }
});

// ─── Round results ─────────────────────────────────────────────
socket.on('round-results', ({ results, round, totalRounds }) => {
  stopVoteTimer();
  renderResults(results, round, totalRounds);
  showScreen('results');
});

// ─── Game over ─────────────────────────────────────────────────
socket.on('game-over', ({ finalScores }) => {
  renderPodium(finalScores);
  setHidden('btn-play-again', !state.isHost);
  showScreen('gameover');
});

// ─── Back to lobby ─────────────────────────────────────────────
socket.on('back-to-lobby', ({ players, settings, isHost }) => {
  state.isHost = isHost || state.isHost;
  state.settings = settings;

  setHidden('host-settings', !state.isHost);
  setHidden('guest-settings', state.isHost);
  setHidden('lobby-host-actions', !state.isHost);
  setHidden('lobby-guest-waiting', state.isHost);

  renderPlayers(players);
  if (!state.isHost) renderGuestSettings(settings);
  showScreen('lobby');
});
