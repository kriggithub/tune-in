import { CARDS } from './cards.js';
import { BAND, WIN, newGame, startTurn, drawCard, resolve } from './logic.js';

const app = document.getElementById('app');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const ME = store.get('tunein.me', null) || Math.random().toString(36).slice(2, 10);
store.set('tunein.me', ME);

let S = null;              // game state
let ROOM = null;           // 4-letter code when playing online
let ui = 'menu';           // non-game screens: menu | cards | join
let setupMode = 'teams';
let flash = '';            // one-off message on the menu / join screen
let prevPhase = null;      // animate the reveal only when we first arrive on it
let openBuiltIn = false;   // keep the built-in list open while removing cards
let deckOpen = false;      // the in-game Cards panel is showing
let deckNote = '';

const esc = t => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const teamName = i => `<span class="t${i}">${esc(S.teams[i].name)}</span>`;
const myCards = () => store.get('tunein.cards', []);
const useBuiltIn = () => store.get('tunein.builtin', true);
const key = c => c.join('|');
const hidden = () => new Set(store.get('tunein.hidden', [])); // built-in cards removed on this phone
const deckForNewGame = () => { const h = hidden(); return [...(useBuiltIn() ? CARDS : []), ...myCards()].filter(c => !h.has(key(c))); };
function removeCard(c) {
  const mine = myCards(), i = mine.findIndex(m => key(m) === key(c));
  if (i >= 0) { mine.splice(i, 1); store.set('tunein.cards', mine); }
  else store.set('tunein.hidden', [...hidden(), key(c)]);
}
function restoreCard(c) {
  const h = hidden();
  if (h.delete(key(c))) store.set('tunein.hidden', [...h]);
  else if (!CARDS.some(b => key(b) === key(c)) && !myCards().some(m => key(m) === key(c))) store.set('tunein.cards', [...myCards(), c]);
}

// ---- saving / syncing ----
function save() {
  if (ROOM) send(); else store.set('tunein.v1', S);
}
const go = phase => { S.phase = phase; save(); render(); };

// ---- online rooms ----
let ws = null, pending = null, skipNext = false, lastNeedleSend = 0, retry = null;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
const roomLink = () => `${location.origin}${location.pathname}?room=${ROOM}`;

function connect() {
  clearTimeout(retry);
  if (!ROOM || (ws && ws.readyState <= 1)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/room/${ROOM}`);
  ws.onopen = () => {
    if (pending) { ws.send(pending); pending = null; skipNext = true; } // our change wins over the stored copy
    renderStatus();
  };
  ws.onmessage = e => {
    if (skipNext) { skipNext = false; return; }
    receive(e.data);
  };
  ws.onclose = () => { renderStatus(); if (ROOM) retry = setTimeout(connect, 1500); };
}

function send() {
  const msg = JSON.stringify(S);
  if (ws && ws.readyState === 1) ws.send(msg); else { pending = msg; connect(); }
}

// trust boundary: anyone with the room code can send anything
function clean(n) {
  if (!n || typeof n !== 'object' || !Array.isArray(n.cards) || !Array.isArray(n.deck)) return null;
  for (const k of ['target', 'needle', 'score', 'cardsLeft', 'active', 'card']) if (k in n) n[k] = Number(n[k]) || 0;
  if (n.teams) n.teams = n.teams.slice(0, 2).map(t => ({ name: String(t.name), score: Number(t.score) || 0 }));
  n.cards = n.cards.filter(c => Array.isArray(c) && c.length === 2).map(c => c.map(String));
  n.skip = Array.isArray(n.skip) ? n.skip.map(String) : [];
  const ok = ['handoff', 'psychic', 'guess', 'call', 'reveal', 'end'].includes(n.phase) && n.card < n.cards.length
    && (n.mode === 'coop' || (n.mode === 'teams' && n.teams?.length === 2));
  return ok ? n : null;
}

function receive(data) {
  let n = null;
  try { n = clean(JSON.parse(data)); } catch {}
  if (!n) {
    if (!S) { flash = `No game found with code ${ROOM}.`; leaveRoom(); }
    return;
  }
  const first = !S, before = S && S.phase;
  S = n;
  if (first) mergeMyCards();
  if (deckOpen) return; // the game screen redraws when the panel closes
  // only the needle moved: update it in place instead of redrawing the screen
  if (before === 'guess' && S.phase === 'guess' && app.querySelector('#needle')) return moveNeedle(S.needle);
  render();
}

// add this device's custom cards to the room's deck (they come up next), and skip the cards it removed
function mergeMyCards() {
  const have = new Set(S.cards.map(key)), h = hidden();
  const add = myCards().filter(c => !have.has(key(c)) && !h.has(key(c)));
  for (const c of add) { S.cards.push(c); S.deck.push(S.cards.length - 1); }
  const skip = [...h].filter(k => have.has(k) && !S.skip.includes(k));
  S.skip.push(...skip);
  if (add.length || skip.length) send();
}

function joinRoom(code) {
  ROOM = code; S = null; store.set('tunein.room', ROOM); connect(); render();
}
function leaveRoom() {
  const old = ws; ROOM = null; ws = null; S = null; ui = 'menu'; deckOpen = false;
  store.set('tunein.room', null);
  if (old) old.close();
  render();
}

// ---- dial (SVG, 200×110, centre 100,100) ----
const R = 90;
const pt = (deg, r) => [100 + r * Math.sin(deg * Math.PI / 180), 100 - r * Math.cos(deg * Math.PI / 180)]; // deg from vertical
const wedge = (a, b) => { const [x1, y1] = pt(a, R), [x2, y2] = pt(b, R); return `M100 100L${x1} ${y1}A${R} ${R} 0 0 1 ${x2} ${y2}Z`; };

function dial({ target = false, needle = true, hidden = false }) {
  const ticks = Array.from({ length: 19 }, (_, i) => {
    const d = i * 10 - 90, [x1, y1] = pt(d, R - (i % 9 ? 5 : 10)), [x2, y2] = pt(d, R - 1);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--amber-dim)" stroke-width="1"/>`;
  }).join('');
  const bands = [[-2.5, -1.5, 2], [-1.5, -0.5, 3], [-0.5, 0.5, 4], [0.5, 1.5, 3], [1.5, 2.5, 2]].map(([a, b, p]) => {
    const [lx, ly] = pt((a + b) / 2 * BAND, R - 14);
    return `<path d="${wedge(a * BAND, b * BAND)}" fill="var(--b${p})"/>
      <text x="${lx}" y="${ly}" font-size="8" font-weight="800" text-anchor="middle" dominant-baseline="middle" fill="#0d1a15">${p}</text>`;
  }).join('');
  return `<svg class="dial" viewBox="0 0 200 110" role="img" aria-label="dial">
    <path d="M${100 - R} 100A${R} ${R} 0 0 1 ${100 + R} 100Z" fill="#23262f" stroke="var(--amber-dim)" stroke-width="1.5"/>
    ${ticks}
    ${target ? `<g class="target" style="opacity:${hidden ? 0 : 1}" transform="rotate(${S.target - 90} 100 100)">${bands}</g>` : ''}
    ${needle ? `<g id="needle" transform="rotate(${S.needle - 90} 100 100)">
      <line x1="100" y1="100" x2="100" y2="${100 - R + 4}" stroke="var(--needle)" stroke-width="2.5" stroke-linecap="round"/></g>` : ''}
    <circle cx="100" cy="100" r="7" fill="var(--needle)"/>
  </svg>`;
}

function moveNeedle(v) {
  S.needle = Math.max(0, Math.min(180, v));
  app.querySelector('#needle')?.setAttribute('transform', `rotate(${S.needle - 90} 100 100)`);
  const range = app.querySelector('#range'); if (range) range.value = S.needle;
}

function cardHTML() {
  const [l, r] = S.cards[S.card];
  return `<div class="card"><div><small>◀ left</small>${esc(l)}</div><div><small>right ▶</small>${esc(r)}</div></div>`;
}

function bindDial() {
  const svg = app.querySelector('svg.dial'), range = app.querySelector('#range');
  const set = v => {
    moveNeedle(v);
    if (ROOM && Date.now() - lastNeedleSend > 80) { lastNeedleSend = Date.now(); send(); }
  };
  const fromPointer = e => {
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    let phi = Math.atan2(100 - q.y, q.x - 100) * 180 / Math.PI; // 0 = right, 90 = up
    if (phi < 0) phi = q.x < 100 ? 180 : 0;
    set(Math.round((180 - phi) * 2) / 2);
  };
  let drag = false;
  svg.addEventListener('pointerdown', e => { drag = true; svg.setPointerCapture(e.pointerId); fromPointer(e); });
  svg.addEventListener('pointermove', e => drag && fromPointer(e));
  svg.addEventListener('pointerup', () => { drag = false; save(); });
  range.addEventListener('input', () => set(+range.value));
  range.addEventListener('change', save);
}

function topBar() {
  const live = ws && ws.readyState === 1;
  const room = ROOM ? `<span class="room" role="img" aria-label="Room ${ROOM}, ${live ? 'connected' : 'reconnecting'}"><i class="${live ? 'on' : ''}"></i></span>` : '';
  const right = `${room}<button class="ghost small" data-act="deck">Cards</button><button class="ghost small" data-act="quit" aria-label="${ROOM ? 'Leave game' : 'Quit game'}">✕</button>`;
  if (S.mode === 'coop') return `<div class="top"><div class="score"><div class="chip"><span>Score</span><b>${S.score}</b></div>
    <div class="chip"><span>To go</span><b>${S.cardsLeft}</b></div></div>${right}</div>`;
  const chip = i => `<div class="chip t${i} ${S.active === i && S.phase !== 'end' ? 'on' : ''}"><span>${esc(S.teams[i].name)}</span><b>${S.teams[i].score}</b></div>`;
  return `<div class="top"><div class="score">${chip(0)}${chip(1)}</div>${right}</div>`;
}
function renderStatus() {
  const i = app.querySelector('.room i'); if (i) i.className = ws && ws.readyState === 1 ? 'on' : '';
}

const RULES = `<details><summary>How to play</summary><ol>
  <li>One player is the <b>psychic</b>. Only they see where the target is on the dial.</li>
  <li>They read the card (two opposite ends) and give <b>one clue</b> that sits where the target is. "Soup" on Cold ↔ Hot might be near Hot.</li>
  <li>Their team talks it over and turns the dial. Closer = more points: 4 for the bullseye, then 3, then 2.</li>
  <li>Teams: the other team then guesses if the target is <b>left or right</b> of the needle for 1 point (not if it's a bullseye).</li>
  <li>First to ${WIN} wins. The second team starts on 1. A bullseye while still behind earns another turn.</li>
  <li>Co-op: everyone's on one team. 7 cards, a bullseye earns the card back. Pass the psychic role around.</li>
  <li>Online: one person taps <b>Play online</b> and shares the code or link. Everyone plays on their own phone; whoever taps "I'm the psychic" gets the secret screen.</li>
</ol></details>`;

const watching = () => ROOM && S.psychic === ME; // online psychic waiting on the others

const views = {
  menu() {
    const n = deckForNewGame().length;
    return `<h1>Tune In</h1><p class="muted">One clue. One dial. Get on the same frequency.</p>
      ${flash ? `<p class="note">${esc(flash)}</p>` : ''}
      <div class="seg" role="group">
        <button data-mode="teams" aria-pressed="${setupMode === 'teams'}">Two teams</button>
        <button data-mode="coop" aria-pressed="${setupMode === 'coop'}">Co-op</button>
      </div>
      ${setupMode === 'teams' ? `<div class="stack">
        <div><label for="n0">Team 1 (goes first)</label><input type="text" id="n0" placeholder="Team 1" maxlength="16"></div>
        <div><label for="n1">Team 2 (starts on 1 point)</label><input type="text" id="n1" placeholder="Team 2" maxlength="16"></div>
      </div>` : `<p class="muted">Everyone plays together. Take turns being the psychic and see how high you can score with 7 cards.</p>`}
      <div class="grow"></div>
      <button data-act="start" ${n ? '' : 'disabled'}>Play on this phone</button>
      <div class="row"><button class="ghost" data-act="host" ${n ? '' : 'disabled'}>Play online</button><button class="ghost" data-act="join">Join with code</button></div>
      <button class="ghost" data-act="cards">Cards · ${n} in the deck</button>
      ${RULES}`;
  },
  join() {
    return `<h2>Join a game</h2><p class="muted">Ask the host for their 4-letter code.</p>
      ${flash ? `<p class="note">${esc(flash)}</p>` : ''}
      <input type="text" id="code" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="ABCD" style="font-size:32px;text-align:center;letter-spacing:8px;text-transform:uppercase">
      <button data-act="do-join">Join</button><div class="grow"></div><button class="ghost" data-act="menu">Back</button>`;
  },
  cards() {
    const mine = myCards(), h = hidden();
    return `<h2>Cards</h2>
      <div class="stack"><p class="muted">Add your own: two opposite ends of a scale. They're saved on this phone and go into every game you start. Online, everyone's custom cards are added to the room's deck.</p>
        <div class="row"><input type="text" id="cl" placeholder="Left end" maxlength="40"><input type="text" id="cr" placeholder="Right end" maxlength="40"></div>
        <button data-act="add-card">Add card</button></div>
      ${mine.length ? `<div class="list">${mine.map((c, i) => `<div class="item"><span>${esc(c[0])} <span class="muted">↔</span> ${esc(c[1])}</span>
        <button class="ghost small" data-del="${i}" aria-label="Delete card">✕</button></div>`).join('')}</div>`
        : `<p class="muted center">No custom cards yet.</p>`}
      <label class="check"><input type="checkbox" id="builtin" ${useBuiltIn() ? 'checked' : ''}> Include the built-in cards</label>
      <details ${openBuiltIn ? 'open' : ''}><summary>Built-in cards · ${CARDS.length - CARDS.filter(c => h.has(key(c))).length} of ${CARDS.length} in use</summary>
        <p class="muted" style="font-size:14px;margin-top:8px">Tap ✕ to remove a card you don't like, ↺ to bring it back.</p>
        <div class="list">${CARDS.map((c, i) => { const off = h.has(key(c)); return `<div class="item ${off ? 'off' : ''}">
          <span>${esc(c[0])} <span class="muted">↔</span> ${esc(c[1])}</span>
          <button class="ghost small" data-${off ? 'unhide' : 'hide'}="${i}" aria-label="${off ? 'Bring back' : 'Remove'} card">${off ? '↺' : '✕'}</button></div>`; }).join('')}</div></details>
      <div class="grow"></div><button class="ghost" data-act="menu">Back</button>`;
  },
  deck() {
    const skip = new Set(S.skip), order = S.cards.map((_, i) => i).reverse(); // newest first
    return `<div class="top"><h2 class="grow" style="font-size:22px">Cards in this game${ROOM ? ` <span class="muted" style="font-size:15px">· room ${ROOM}</span>` : ''}</h2><button class="small" data-act="deck-done">Done</button></div>
      <div class="row"><input type="text" id="gl" placeholder="Left end" maxlength="40"><input type="text" id="gr" placeholder="Right end" maxlength="40"></div>
      <button class="ghost" data-act="deck-add">Add to this game</button>
      ${deckNote ? `<p class="note">${esc(deckNote)}</p>` : ''}
      <p class="muted" style="font-size:14px">${S.cards.filter(c => !skip.has(key(c))).length} of ${S.cards.length} in play. ✕ removes a card, ↺ brings it back. New cards come up next and are saved to your phone.</p>
      <div class="list">${order.map(i => { const c = S.cards[i], off = skip.has(key(c)); return `<div class="item ${off ? 'off' : ''}">
        <span>${esc(c[0])} <span class="muted">↔</span> ${esc(c[1])}</span>
        <button class="ghost small" data-g${off ? 'unskip' : 'skip'}="${i}" aria-label="${off ? 'Bring back' : 'Remove'} card">${off ? '↺' : '✕'}</button></div>`; }).join('')}</div>`;
  },
  handoff() {
    if (ROOM) {
      const who = S.mode === 'teams' ? `${teamName(S.active)}: who's the psychic?` : `Who's the psychic this round?`;
      return `${topBar()}<div class="grow"></div>
        <div class="stack center"><h2>${who}</h2><p class="muted">Room <b>${ROOM}</b>. Others can join with the code or the link.</p>
        <button class="ghost" data-act="share">Share invite link</button></div>
        <div class="grow"></div><button data-act="reveal-target">I'm the psychic</button>`;
    }
    const who = S.mode === 'teams' ? `a psychic on ${teamName(S.active)}` : 'the next psychic';
    return `${topBar()}<div class="grow"></div>
      <div class="stack center"><h2>Pass the phone to ${who}.</h2><p class="muted">Everyone else, look away.</p></div>
      <div class="grow"></div><button data-act="reveal-target">I'm the psychic, show me</button>`;
  },
  psychic() {
    if (ROOM && S.psychic !== ME) return `${topBar()}<div class="grow"></div>
      <div class="stack center"><h2>The psychic is thinking of a clue…</h2></div>${dial({ needle: false })}${cardHTML()}<div class="grow"></div>`;
    return `${topBar()}<p class="muted center">Only you can see this. Think of a clue that sits on the target.</p>
      ${dial({ target: true, needle: false })}${cardHTML()}
      <div><label for="clue">${ROOM ? 'Your clue' : 'Your clue (optional: you can just say it out loud)'}</label>
        <input type="text" id="clue" maxlength="60" value="${esc(S.clue)}" autocomplete="off"></div>
      <button class="ghost" data-act="new-card">Different card</button>
      <div class="grow"></div>
      <button data-act="to-guess">${ROOM ? 'Send the clue' : 'Hide the target, pass the phone'}</button>`;
  },
  guess() {
    const who = S.mode === 'teams' ? teamName(S.active) : 'Everyone';
    const clue = S.clue ? `<p class="clue">“${esc(S.clue)}”</p>` : '';
    if (watching()) return `${topBar()}<p class="center muted">They're turning the dial…</p>${clue}
      ${dial({ target: true })}${cardHTML()}<div class="grow"></div>`;
    return `${topBar()}<p class="center">${who}: talk it over and set the dial.</p>${clue}
      ${dial({})}<input type="range" id="range" min="0" max="180" step="0.5" value="${S.needle}" aria-label="Dial position">
      ${cardHTML()}<div class="grow"></div><button data-act="lock">Lock it in</button>`;
  },
  call() {
    const clue = S.clue ? `<p class="clue">“${esc(S.clue)}”</p>` : '';
    if (watching()) return `${topBar()}<p class="center muted">${teamName(1 - S.active)} is calling left or right…</p>${clue}
      ${dial({ target: true })}${cardHTML()}<div class="grow"></div>`;
    return `${topBar()}<p class="center">${teamName(1 - S.active)}: is the target <b>left</b> or <b>right</b> of the needle?</p>${clue}
      ${dial({})}${cardHTML()}<div class="grow"></div>
      <div class="row"><button data-call="left">◀ Left</button><button data-call="right">Right ▶</button></div>`;
  },
  reveal() {
    const r = S.last, lines = [];
    let head;
    if (S.mode === 'coop') {
      head = r.pts ? `+${r.pts}` : 'Miss';
      if (r.bonus) lines.push('Bullseye! You keep the card.');
    } else {
      head = `${r.pts ? '+' + r.pts : 'Miss'} <span style="font-size:22px">${teamName(r.team)}</span>`;
      if (r.pts === 4) lines.push('Bullseye!');
      if (r.oppPt) lines.push(`+1 ${teamName(1 - r.team)} for the right call`);
      if (r.extraTurn) lines.push(`Bullseye while behind: ${teamName(r.team)} goes again`);
      if (r.suddenDeath) lines.push('Tied at the top. Sudden death: keep playing until someone pulls ahead.');
    }
    return `${topBar()}${dial({ target: true, hidden: prevPhase !== 'reveal' })}${cardHTML()}
      ${S.clue ? `<p class="clue">“${esc(S.clue)}”</p>` : ''}
      <div class="big">${head}</div>
      ${lines.map(l => `<p class="center">${l}</p>`).join('')}
      <div class="grow"></div>
      ${S.skip.includes(key(S.cards[S.card])) ? `<p class="center muted">Card removed. You won't see it again.</p>`
        : `<button class="ghost small" data-act="drop">Don't show this card again</button>`}
      <button data-act="next">${S.winner !== null ? 'See the result' : 'Next round'}</button>`;
  },
  end() {
    const body = S.mode === 'coop'
      ? `<p class="muted">Final score</p><div class="big">${S.score}</div>`
      : `<div class="big">${teamName(S.winner)}</div><h2>wins ${S.teams[S.winner].score}–${S.teams[1 - S.winner].score}</h2>`;
    return `${topBar()}<div class="grow"></div><div class="stack center">${body}</div><div class="grow"></div>
      <button data-act="again">Play again</button><button class="ghost" data-act="quit">${ROOM ? 'Leave' : 'Back to menu'}</button>`;
  },
};

function names() {
  return setupMode === 'teams' ? [0, 1].map(i => app.querySelector('#n' + i).value.trim() || `Team ${i + 1}`) : [];
}

const actions = {
  start() { flash = ''; S = newGame(setupMode, names(), deckForNewGame()); save(); render(); },
  host() {
    flash = ''; const game = newGame(setupMode, names(), deckForNewGame());
    joinRoom(newCode()); S = game; save(); render();
  },
  join() { flash = ''; ui = 'join'; render(); app.querySelector('#code').focus(); },
  'do-join'() {
    const code = app.querySelector('#code').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { flash = 'Codes are 4 letters.'; return render(); }
    flash = ''; joinRoom(code);
  },
  cards() { flash = ''; ui = 'cards'; render(); },
  'add-card'() {
    const l = app.querySelector('#cl').value.trim(), r = app.querySelector('#cr').value.trim();
    if (!l || !r) return;
    store.set('tunein.cards', [...myCards(), [l, r]]); render(); app.querySelector('#cl').focus();
  },
  share() {
    const url = roomLink();
    if (navigator.share) navigator.share({ title: 'Tune In', text: `Join my Tune In game: ${ROOM}`, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => alert('Link copied'));
  },
  'reveal-target'() { startTurn(S); S.psychic = ME; save(); render(); },
  'new-card'() { drawCard(S); save(); render(); },
  deck() { deckOpen = true; deckNote = ''; render(); },
  'deck-done'() { deckOpen = false; deckNote = ''; render(); },
  'deck-add'() {
    const l = app.querySelector('#gl').value.trim(), r = app.querySelector('#gr').value.trim();
    if (!l || !r) return;
    const c = [l, r], k = key(c), i = S.cards.findIndex(x => key(x) === k);
    restoreCard(c); // saves it to this phone's custom cards (or un-removes a built-in)
    if (i < 0) { S.cards.push(c); S.deck.push(S.cards.length - 1); }
    else { S.skip = S.skip.filter(x => x !== k); S.deck = S.deck.filter(x => x !== i); S.deck.push(i); }
    deckNote = `Added: ${l} ↔ ${r}. It comes up next.`;
    save(); render(); app.querySelector('#gl').focus();
  },
  drop() { const c = S.cards[S.card]; removeCard(c); S.skip.push(key(c)); save(); render(); },
  'to-guess'() { go('guess'); },
  lock() { S.mode === 'teams' ? go('call') : (resolve(S), save(), render()); },
  next() { go(S.winner !== null ? 'end' : 'handoff'); },
  again() { S = newGame(S.mode, S.teams ? S.teams.map(t => t.name) : [], ROOM ? S.cards : deckForNewGame()); save(); render(); },
  menu() { ui = 'menu'; S = null; deckOpen = false; store.set('tunein.v1', null); render(); },
  quit() {
    if (ROOM) { if (confirm('Leave this online game? You can rejoin with the code.')) leaveRoom(); }
    else if (S.phase === 'end' || confirm('Quit this game?')) actions.menu();
  },
};

app.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mode) { setupMode = b.dataset.mode; render(); }
  else if (b.dataset.call) { S.call = b.dataset.call; resolve(S); save(); render(); }
  else if (b.dataset.del) { const c = myCards(); c.splice(+b.dataset.del, 1); store.set('tunein.cards', c); render(); }
  else if (b.dataset.hide || b.dataset.unhide) {
    const k = key(CARDS[+(b.dataset.hide ?? b.dataset.unhide)]), h = hidden();
    b.dataset.hide ? h.add(k) : h.delete(k);
    store.set('tunein.hidden', [...h]); openBuiltIn = true;
    const y = window.scrollY; render(); window.scrollTo(0, y); // stay where you were in the long list
  }
  else if (b.dataset.gskip || b.dataset.gunskip) {
    const i = +(b.dataset.gskip ?? b.dataset.gunskip), c = S.cards[i], k = key(c);
    if (b.dataset.gskip) { removeCard(c); if (!S.skip.includes(k)) S.skip.push(k); }
    else { restoreCard(c); S.skip = S.skip.filter(x => x !== k); if (!S.deck.includes(i)) S.deck.unshift(i); }
    deckNote = ''; save();
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }
  else if (b.dataset.act) actions[b.dataset.act]();
});
app.addEventListener('input', e => {
  if (e.target.id === 'clue') { S.clue = e.target.value; if (!ROOM) save(); } // online: sent with "Send the clue"
});
app.addEventListener('change', e => { if (e.target.id === 'builtin') { store.set('tunein.builtin', e.target.checked); render(); } });
app.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') actions['do-join']();
  if (e.target.id === 'cl') app.querySelector('#cr').focus();
  if (e.target.id === 'cr') actions['add-card']();
  if (e.target.id === 'gl') app.querySelector('#gr').focus();
  if (e.target.id === 'gr') actions['deck-add']();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) connect(); });

function render() {
  if (ROOM && !S) {
    app.innerHTML = `<div class="grow"></div><div class="stack center"><h2>Joining ${ROOM}…</h2></div><div class="grow"></div>
      <button class="ghost" data-act="quit">Cancel</button>`;
    return;
  }
  app.innerHTML = !S ? views[ui]() : deckOpen ? views.deck() : views[S.phase]();
  window.scrollTo(0, 0);
  if (deckOpen) return;
  prevPhase = S && S.phase;
  if (S && S.phase === 'guess' && !watching()) bindDial();
  if (S && S.phase === 'reveal') requestAnimationFrame(() => requestAnimationFrame(() => {
    const t = app.querySelector('.target'); if (t) t.style.opacity = 1;
  }));
}

// start: invite link > online game in progress > local game in progress > menu
const linkCode = new URLSearchParams(location.search).get('room');
if (linkCode) history.replaceState(null, '', location.pathname);
const resume = (linkCode || store.get('tunein.room', '') || '').toUpperCase();
if (/^[A-Z]{4}$/.test(resume)) joinRoom(resume);
else { S = store.get('tunein.v1', null); if (S && !S.cards) S = null; if (S) S.skip ||= []; render(); } // old saves without a deck are dropped
