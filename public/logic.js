// Pure game rules — no DOM. Angles are degrees on a half dial: 0 = left end, 180 = right end.
export const BAND = 7;          // width of one scoring band; the target is 2-3-4-3-2 = 5 bands
export const WIN = 10;
export const COOP_CARDS = 7;

export function shuffle(n, rand = Math.random) {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// keep the whole target on the dial
export const randomTarget = (rand = Math.random) => 2.5 * BAND + rand() * (180 - 5 * BAND);

export function points(target, needle) {
  const d = Math.abs(target - needle);
  return d <= BAND / 2 ? 4 : d <= 1.5 * BAND ? 3 : d <= 2.5 * BAND ? 2 : 0;
}

export const sideOf = (target, needle) => (target < needle ? 'left' : target > needle ? 'right' : null);

export function newGame(mode, names, cards, rand = Math.random) {
  const s = { mode, phase: 'handoff', cards, deck: shuffle(cards.length, rand), card: null,
    target: 90, needle: 90, clue: '', call: null, last: null, winner: null, skip: [] };
  if (mode === 'teams') {
    s.teams = [{ name: names[0], score: 0 }, { name: names[1], score: 1 }]; // second team starts on 1
    s.active = 0;
  } else {
    s.score = 0; s.cardsLeft = COOP_CARDS;
  }
  return s;
}

// s.skip: cards a player removed mid-game ("left|right" keys); never drawn again in this game
export function drawCard(s, rand = Math.random) {
  const skip = new Set(s.skip || []);
  const ok = i => !skip.has(s.cards[i].join('|'));
  s.deck = s.deck.filter(ok);
  if (!s.deck.length) s.deck = shuffle(s.cards.length, rand).filter(ok);
  if (!s.deck.length) s.deck = shuffle(s.cards.length, rand); // everything removed: ignore the list
  s.card = s.deck.pop();
}

export function startTurn(s, rand = Math.random) {
  drawCard(s, rand);
  s.target = randomTarget(rand);
  s.needle = 90; s.clue = ''; s.call = null; s.phase = 'psychic';
}

export function resolve(s) {
  const pts = points(s.target, s.needle);
  const r = { pts };
  if (s.mode === 'coop') {
    s.score += pts;
    r.bonus = pts === 4;                 // a bullseye earns the card back
    if (!r.bonus) s.cardsLeft -= 1;
    if (s.cardsLeft <= 0) s.winner = 'coop';
  } else {
    const a = s.active, o = 1 - a, T = s.teams;
    r.team = a;
    T[a].score += pts;
    r.oppPt = pts !== 4 && s.call === sideOf(s.target, s.needle) ? 1 : 0; // no steal on a bullseye
    T[o].score += r.oppPt;
    r.extraTurn = pts === 4 && T[a].score < T[o].score;                    // catch-up rule
    const [x, y] = [T[0].score, T[1].score];
    if (Math.max(x, y) >= WIN && x !== y) s.winner = x > y ? 0 : 1;
    else if (!r.extraTurn) s.active = o;
    r.suddenDeath = s.winner === null && x === y && x >= WIN;
  }
  s.last = r; s.phase = 'reveal';
  return r;
}
