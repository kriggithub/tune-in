import { CARDS } from './cards.js';
import { BAND, WIN, newGame, startTurn, drawCard, resolve } from './logic.js';

const KEY = 'tunein.v1';
const app = document.getElementById('app');
let S = load();
let setupMode = 'teams';

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save() { try { S ? localStorage.setItem(KEY, JSON.stringify(S)) : localStorage.removeItem(KEY); } catch {} }
const esc = t => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const teamName = i => `<span class="t${i}">${esc(S.teams[i].name)}</span>`;
const go = phase => { S.phase = phase; save(); render(); };

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

function cardHTML() {
  const [l, r] = CARDS[S.card];
  return `<div class="card"><div><small>◀ left</small>${esc(l)}</div><div><small>right ▶</small>${esc(r)}</div></div>`;
}

function bindDial() {
  const svg = app.querySelector('svg.dial'), range = app.querySelector('#range'), needle = app.querySelector('#needle');
  const set = v => { S.needle = Math.max(0, Math.min(180, v)); needle.setAttribute('transform', `rotate(${S.needle - 90} 100 100)`); range.value = S.needle; };
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
  const right = `<button class="ghost small" data-act="quit" aria-label="Quit game">✕</button>`;
  if (S.mode === 'coop') return `<div class="top"><div class="score"><div class="chip"><span>Score</span><b>${S.score}</b></div>
    <div class="chip"><span>Cards left</span><b>${S.cardsLeft}</b></div></div>${right}</div>`;
  const chip = i => `<div class="chip t${i} ${S.active === i && S.phase !== 'end' ? 'on' : ''}"><span>${esc(S.teams[i].name)}</span><b>${S.teams[i].score}</b></div>`;
  return `<div class="top"><div class="score">${chip(0)}${chip(1)}</div>${right}</div>`;
}

const RULES = `<details><summary>How to play</summary><ol>
  <li>One player is the <b>psychic</b>. Only they see where the target is on the dial.</li>
  <li>They read the card (two opposite ends) and say <b>one clue</b> that sits where the target is. "Soup" on Cold ↔ Hot might be near Hot.</li>
  <li>Their team talks it over and turns the dial. Closer = more points: 4 for the bullseye, then 3, then 2.</li>
  <li>Teams: the other team then guesses if the target is <b>left or right</b> of the needle for 1 point (not if it's a bullseye).</li>
  <li>First to ${WIN} wins. The second team starts on 1. A bullseye while still behind earns another turn.</li>
  <li>Co-op: everyone's on one team. 7 cards, a bullseye earns the card back. Pass the psychic role around.</li>
</ol></details>`;

const views = {
  setup() {
    return `<h1>Tune In</h1><p class="muted">One clue. One dial. Get on the same frequency.</p>
      <div class="seg" role="group">
        <button data-mode="teams" aria-pressed="${setupMode === 'teams'}">Two teams</button>
        <button data-mode="coop" aria-pressed="${setupMode === 'coop'}">Co-op</button>
      </div>
      ${setupMode === 'teams' ? `<div class="stack">
        <div><label for="n0">Team 1 (goes first)</label><input type="text" id="n0" placeholder="Team 1" maxlength="16"></div>
        <div><label for="n1">Team 2 (starts on 1 point)</label><input type="text" id="n1" placeholder="Team 2" maxlength="16"></div>
      </div>` : `<p class="muted">Everyone plays together. Take turns being the psychic and see how high you can score with 7 cards.</p>`}
      ${RULES}<div class="grow"></div><button data-act="start">Start game</button>`;
  },
  handoff() {
    const who = S.mode === 'teams' ? `a psychic on ${teamName(S.active)}` : 'the next psychic';
    return `${topBar()}<div class="grow"></div>
      <div class="stack center"><h2>Pass the phone to ${who}.</h2><p class="muted">Everyone else, look away.</p></div>
      <div class="grow"></div><button data-act="reveal-target">I'm the psychic, show me</button>`;
  },
  psychic() {
    return `${topBar()}<p class="muted center">Only you can see this. Think of a clue that sits on the target.</p>
      ${dial({ target: true, needle: false })}${cardHTML()}
      <div><label for="clue">Your clue (optional: you can just say it out loud)</label>
        <input type="text" id="clue" maxlength="60" value="${esc(S.clue)}" autocomplete="off"></div>
      <button class="ghost" data-act="new-card">Different card</button>
      <div class="grow"></div>
      <button data-act="to-guess">Hide the target, pass the phone</button>`;
  },
  guess() {
    const who = S.mode === 'teams' ? teamName(S.active) : 'Everyone';
    return `${topBar()}<p class="center">${who}: talk it over and set the dial.</p>
      ${S.clue ? `<p class="clue">“${esc(S.clue)}”</p>` : ''}
      ${dial({})}<input type="range" id="range" min="0" max="180" step="0.5" value="${S.needle}" aria-label="Dial position">
      ${cardHTML()}<div class="grow"></div><button data-act="lock">Lock it in</button>`;
  },
  call() {
    return `${topBar()}<p class="center">${teamName(1 - S.active)}: is the target <b>left</b> or <b>right</b> of the needle?</p>
      ${S.clue ? `<p class="clue">“${esc(S.clue)}”</p>` : ''}
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
    return `${topBar()}${dial({ target: true, hidden: true })}${cardHTML()}
      ${S.clue ? `<p class="clue">“${esc(S.clue)}”</p>` : ''}
      <div class="big">${head}</div>
      ${lines.map(l => `<p class="center">${l}</p>`).join('')}
      <div class="grow"></div>
      <button data-act="next">${S.winner !== null ? 'See the result' : 'Next round'}</button>`;
  },
  end() {
    const body = S.mode === 'coop'
      ? `<p class="muted">Final score</p><div class="big">${S.score}</div>`
      : `<div class="big">${teamName(S.winner)}</div><h2>wins ${S.teams[S.winner].score}–${S.teams[1 - S.winner].score}</h2>`;
    return `${topBar()}<div class="grow"></div><div class="stack center">${body}</div><div class="grow"></div>
      <button data-act="again">Play again</button><button class="ghost" data-act="menu">Back to menu</button>`;
  },
};

const actions = {
  start() {
    const names = setupMode === 'teams'
      ? [0, 1].map(i => app.querySelector('#n' + i).value.trim() || `Team ${i + 1}`) : [];
    S = newGame(setupMode, names, CARDS.length); save(); render();
  },
  'reveal-target'() { startTurn(S); save(); render(); },
  'new-card'() { drawCard(S); save(); render(); },
  'to-guess'() { go('guess'); },
  lock() { S.mode === 'teams' ? go('call') : (resolve(S), save(), render()); },
  next() { go(S.winner !== null ? 'end' : 'handoff'); },
  again() { S = newGame(S.mode, S.teams ? S.teams.map(t => t.name) : [], CARDS.length); save(); render(); },
  menu() { S = null; save(); render(); },
  quit() { if (confirm('Quit this game?')) actions.menu(); },
};

app.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mode) { setupMode = b.dataset.mode; render(); }
  else if (b.dataset.call) { S.call = b.dataset.call; resolve(S); save(); render(); }
  else if (b.dataset.act) actions[b.dataset.act]();
});
app.addEventListener('input', e => { if (e.target.id === 'clue') { S.clue = e.target.value; save(); } });

function render() {
  app.innerHTML = views[S ? S.phase : 'setup']();
  window.scrollTo(0, 0);
  if (S && (S.phase === 'guess')) bindDial();
  if (S && S.phase === 'reveal') requestAnimationFrame(() => requestAnimationFrame(() => {
    const t = app.querySelector('.target'); if (t) t.style.opacity = 1;
  }));
}
render();
