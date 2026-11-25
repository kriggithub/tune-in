// node test.mjs — checks the scoring rules
import assert from 'node:assert/strict';
import { BAND, points, sideOf, newGame, resolve, startTurn } from './public/logic.js';

assert.equal(points(90, 90), 4);
assert.equal(points(90, 90 + BAND / 2), 4);
assert.equal(points(90, 90 + BAND), 3);
assert.equal(points(90, 90 - 2 * BAND), 2);
assert.equal(points(90, 90 + 2.6 * BAND), 0);
assert.equal(sideOf(40, 90), 'left');
assert.equal(sideOf(140, 90), 'right');

const CARDS = Array.from({ length: 10 }, (_, i) => ['l' + i, 'r' + i]);
const game = () => { const s = newGame('teams', ['A', 'B'], CARDS); startTurn(s); return s; };

// second team starts on 1
assert.deepEqual(game().teams.map(t => t.score), [0, 1]);

// 3 points + correct steal, then turn passes
let s = game(); s.target = 100; s.needle = 100 - BAND; s.call = 'right';
let r = resolve(s);
assert.equal(r.pts, 3); assert.equal(r.oppPt, 1);
assert.deepEqual(s.teams.map(t => t.score), [3, 2]); assert.equal(s.active, 1);

// no steal on a bullseye
s = game(); s.target = 100; s.needle = 100.5; s.call = 'left';
r = resolve(s); assert.equal(r.pts, 4); assert.equal(r.oppPt, 0);

// catch-up: bullseye while still behind keeps the turn
s = game(); s.teams[1].score = 8; s.target = 100; s.needle = 100;
r = resolve(s); assert.equal(r.extraTurn, true); assert.equal(s.active, 0);

// win at 10, higher score wins
s = game(); s.teams[0].score = 7; s.target = 100; s.needle = 101; s.call = 'left';
resolve(s); assert.equal(s.winner, 0);

// both reach 10 tied → sudden death, no winner yet
s = game(); s.teams[0].score = 8; s.teams[1].score = 9; s.target = 100; s.needle = 100 - 2 * BAND; s.call = 'right';
r = resolve(s); assert.equal(s.winner, null); assert.equal(r.suddenDeath, true);

// co-op: bullseye gives the card back, game ends when cards run out
s = newGame('coop', [], CARDS); startTurn(s); s.target = 90; s.needle = 90; resolve(s);
assert.equal(s.cardsLeft, 7); assert.equal(s.score, 4);
s.cardsLeft = 1; startTurn(s); s.target = 20; s.needle = 160; resolve(s);
assert.equal(s.winner, 'coop');

console.log('all rules ok');
