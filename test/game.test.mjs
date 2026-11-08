import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, cloneBoard } from '../src/logic/board.mjs';
import { createPiece } from '../src/logic/piece.mjs';
import { createGame, applyAction, tick, dropInterval } from '../src/logic/game.mjs';

function floorState(seed = 123) {
  return { ...createGame(seed), current: { ...createPiece([1, 2]), x: 0, y: 12 } };
}

// Two full top rows clear in sequence: hidden twos drop into row 1
// after the visible ones clear. The checkerboard supports never match.
function topChainState() {
  const s = createGame(123);
  for (let y = 2; y <= 12; y++) {
    for (let x = 0; x < 4; x++) s.board[y][x] = 3 + ((x + y) % 2);
  }
  for (const x of [0, 1, 3]) {
    s.board[0][x] = 2;
    s.board[1][x] = 1;
  }
  return { ...s, current: createPiece([1, 2]), score: 100, maxChain: 1 };
}

test('new games have an empty independent board, a spawn pair, preview, and zero counters', () => {
  const a = createGame(1);
  const b = createGame(1);
  assert.deepEqual(a.board, createBoard());
  assert.deepEqual(a.current, { x: 2, y: 1, rot: 0, colors: [3, 1] });
  assert.deepEqual(a.next, [3, 4]);
  assert.deepEqual([a.score, a.lastChain, a.maxChain, a.over, a.paused, a.elapsedMs],
    [0, 0, 0, false, false, 0]);
  assert.equal(typeof a.rng, 'function');
  a.board[12][0] = 4;
  assert.equal(b.board[12][0], 0);
  assert.equal(createGame().over, false);
});

test('actions move and rotate through the piece rules without mutating the source state', () => {
  const s = { ...createGame(1), elapsedMs: 300 };
  const original = structuredClone({ ...s, rng: null });
  const left = applyAction(s, 'left');
  assert.equal(left.state.current.x, 1);
  assert.deepEqual(left.events, []);
  assert.equal(applyAction(s, 'right').state.current.x, 3);
  assert.equal(applyAction(s, 'rotL').state.current.rot, 3);
  assert.equal(applyAction(s, 'rotR').state.current.rot, 1);
  assert.equal(left.state.elapsedMs, 300);
  assert.deepEqual({ ...s, rng: null }, original);
  const edge = { ...s, current: { ...s.current, x: 0 } };
  assert.strictEqual(applyAction(edge, 'left').state, edge);
});

test('manual down moves one row and resets elapsedMs to zero', () => {
  const s = { ...createGame(1), elapsedMs: 799 };
  const result = applyAction(s, 'down');
  assert.equal(result.state.current.y, 2);
  assert.equal(result.state.elapsedMs, 0);
  assert.deepEqual(result.events, []);
  assert.equal(tick(result.state, 1).state.current.y, 2);
  assert.equal(s.elapsedMs, 799);
});

test('manual down that locks resets the timer so the spawned pair inherits no elapsed time', () => {
  const s = { ...floorState(), elapsedMs: 799, lastChain: 3, maxChain: 3 };
  const result = applyAction(s, 'down');
  assert.deepEqual(result.events.map(e => e.type), ['lock', 'spawn']);
  assert.deepEqual(result.state.current.colors, s.next);
  assert.equal(result.state.current.y, 1);
  assert.equal(result.state.elapsedMs, 0);
  assert.equal(result.state.lastChain, 0);
  assert.equal(result.state.maxChain, 3);
  const nextFrame = tick(result.state, 1);
  assert.equal(nextFrame.state.current.y, 1);
  assert.equal(nextFrame.state.elapsedMs, 1);
  assert.equal(s.board[12][0], 0);
  assert.equal(s.current.y, 12);
  assert.equal(s.elapsedMs, 799);
});

test('tick carries fractional time and drops only when an interval is reached', () => {
  const s = createGame(1);
  const a = tick(s, 799.5);
  assert.equal(a.state.current.y, 1);
  assert.equal(a.state.elapsedMs, 799.5);
  const b = tick(a.state, 0.5);
  assert.equal(b.state.current.y, 2);
  assert.equal(b.state.elapsedMs, 0);
  assert.deepEqual(b.events, []);
  assert.equal(s.elapsedMs, 0);
});

test('one tick processes multiple intervals and retains the remainder while the same pair falls', () => {
  const result = tick(createGame(1), 1700);
  assert.equal(result.state.current.y, 3);
  assert.equal(result.state.elapsedMs, 100);
  assert.deepEqual(result.events, []);
});

test('automatic landing emits lock then spawn and starts the new pair with a fresh timer', () => {
  const s = floorState();
  const result = tick(s, 2500);
  assert.deepEqual(result.events.map(e => e.type), ['lock', 'spawn']);
  assert.equal(result.state.elapsedMs, 0);
  assert.equal(result.state.current.y, 1);
  assert.deepEqual(result.state.current.colors, s.next);
  assert.deepEqual(result.events[0].piece, s.current);
  assert.equal(result.events[0].board[12][0], 1);
  assert.deepEqual(result.events[1].piece, result.state.current);
});

test('spawn blockage during two clearing steps is checked only after the entire chain', () => {
  const s = topChainState();
  const before = cloneBoard(s.board);
  const result = applyAction(s, 'down');
  assert.deepEqual(result.events.map(e => e.type), ['lock', 'clear', 'clear', 'spawn']);
  assert.equal(result.events[0].board[1][2], 1);
  const steps = result.events.filter(e => e.type === 'clear').map(e => e.step);
  assert.deepEqual(steps.map(({ chain, cleared, score }) => ({ chain, cleared, score })),
    [{ chain: 1, cleared: 4, score: 40 }, { chain: 2, cleared: 4, score: 80 }]);
  assert.ok(steps[1].groups.flat().some(c => c.x === 2 && c.y === 1));
  assert.equal(result.state.board[1][2], 0);
  assert.equal(result.state.over, false);
  assert.equal(result.state.score, 220);
  assert.equal(result.state.lastChain, 2);
  assert.equal(result.state.maxChain, 2);
  assert.deepEqual(s.board, before);
});

test('automatic landing resolves chains before checking game over too', () => {
  const result = tick(topChainState(), 800);
  assert.deepEqual(result.events.map(e => e.type), ['lock', 'clear', 'clear', 'spawn']);
  assert.equal(result.state.over, false);
  assert.equal(result.state.score, 220);
});

test('a spawn cell still blocked after resolution ends the game without spawning', () => {
  const s = createGame(123);
  for (let y = 2; y <= 12; y++) s.board[y][2] = 3 + (y % 2);
  s.current = createPiece([1, 2]);
  const result = applyAction(s, 'down');
  assert.equal(result.state.over, true);
  assert.equal(result.state.current, null);
  assert.equal(result.state.board[1][2], 1);
  assert.equal(result.state.elapsedMs, 0);
  assert.deepEqual(result.state.next, s.next);
  assert.deepEqual(result.events.map(e => e.type), ['lock', 'gameover']);
});

test('game over is also checked when a chain clears elsewhere but leaves spawn blocked', () => {
  const s = createGame(123);
  for (let y = 2; y <= 12; y++) s.board[y][2] = 3 + (y % 2);
  for (let y = 9; y <= 12; y++) s.board[y][5] = 4;
  s.current = createPiece([1, 2]);
  const result = applyAction(s, 'down');
  assert.deepEqual(result.events.map(e => e.type), ['lock', 'clear', 'gameover']);
  assert.equal(result.state.over, true);
  assert.equal(result.state.score, 40);
  assert.equal(result.state.lastChain, 1);
});

test('drop interval decreases at each 1000 points and bottoms out at 150ms', () => {
  for (const [score, expected] of [[0, 800], [999, 800], [1000, 750], [12999, 200], [13000, 150], [100000, 150]]) {
    assert.equal(dropInterval({ score }), expected);
  }
  const s = { ...createGame(1), score: 1000 };
  assert.equal(tick(s, 750).state.current.y, 2);
});

test('pause freezes ticks and gameplay actions, and pause toggles resume', () => {
  const s = { ...createGame(1), elapsedMs: 500 };
  const paused = applyAction(s, 'pause');
  assert.equal(paused.state.paused, true);
  assert.deepEqual(paused.events, []);
  assert.strictEqual(tick(paused.state, 99999).state, paused.state);
  for (const action of ['left', 'right', 'down', 'rotL', 'rotR']) {
    assert.deepEqual(applyAction(paused.state, action), { state: paused.state, events: [] });
  }
  const resumed = applyAction(paused.state, 'pause').state;
  assert.equal(resumed.paused, false);
  assert.equal(tick(resumed, 300).state.current.y, 2);
});

test('game over freezes ticks and gameplay actions while pause remains toggleable', () => {
  const s = { ...createGame(1), current: null, over: true };
  assert.deepEqual(tick(s, 99999), { state: s, events: [] });
  for (const action of ['left', 'right', 'down', 'rotL', 'rotR']) {
    assert.deepEqual(applyAction(s, action), { state: s, events: [] });
  }
  assert.equal(applyAction(s, 'pause').state.paused, true);
});

test('same-seed games produce the same entire pair sequence across repeated spawns', () => {
  const sequence = seed => {
    let state = createGame(seed);
    const result = [];
    for (let i = 0; i < 30; i++) {
      result.push([...state.current.colors]);
      state = { ...state, board: createBoard(), current: { ...state.current, x: 0, y: 12 } };
      state = applyAction(state, 'down').state;
    }
    return result;
  };
  assert.deepEqual(sequence(123), sequence(123));
  assert.notDeepEqual(sequence(123), sequence(124));
});

test('replaying a spawn from the same state leaves its RNG unchanged and gives the same preview', () => {
  const s = floorState();
  const first = applyAction(s, 'down').state;
  const second = applyAction(s, 'down').state;
  assert.deepEqual(first.current, second.current);
  assert.deepEqual(first.next, second.next);
  const advance = state => applyAction({ ...state, board: createBoard(), current: { ...state.current, y: 12 } }, 'down').state;
  assert.deepEqual(advance(first).next, advance(second).next);
});

test('nonpositive or nonfinite tick durations leave the state untouched', () => {
  const s = createGame(1);
  for (const dt of [0, -1, NaN, Infinity]) {
    assert.deepEqual(tick(s, dt), { state: s, events: [] });
  }
});
