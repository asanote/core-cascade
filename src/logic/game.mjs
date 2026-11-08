import { SPAWN_X, SPAWN_Y } from './constants.mjs';
import { createBoard } from './board.mjs';
import { createPiece, movePiece, rotatePiece } from './piece.mjs';
import { makeRng, randomPair } from './rng.mjs';
import { lockPiece, resolveChains } from './resolve.mjs';

export function createGame(seed = Date.now()) {
  const rng = makeRng(seed);
  const current = createPiece(randomPair(rng));
  const next = randomPair(rng);
  return {
    board: createBoard(), current, next,
    score: 0, lastChain: 0, maxChain: 0,
    over: false, paused: false, elapsedMs: 0, rng,
  };
}

export function dropInterval(state) {
  return Math.max(150, 800 - Math.floor(state.score / 1000) * 50);
}

function unchanged(state) {
  return { state, events: [] };
}

function landAndSpawn(state) {
  const locked = lockPiece(state.board, state.current);
  const resolved = resolveChains(locked);
  const events = [
    { type: 'lock', piece: state.current, board: locked },
    ...resolved.steps.map(step => ({ type: 'clear', step })),
  ];
  const lastChain = resolved.steps.length;
  const settled = {
    ...state, board: resolved.board, current: null,
    score: state.score + resolved.totalScore,
    lastChain, maxChain: Math.max(state.maxChain, lastChain), elapsedMs: 0,
  };
  // The spawn check must wait until every clearing and gravity step finishes.
  if (settled.board[SPAWN_Y][SPAWN_X] !== 0) {
    return { state: { ...settled, over: true }, events: [...events, { type: 'gameover' }] };
  }
  const rng = state.rng.clone();
  const current = createPiece(state.next);
  const next = randomPair(rng);
  return {
    state: { ...settled, current, next, rng },
    events: [...events, { type: 'spawn', piece: current }],
  };
}

function fallOne(state) {
  const current = movePiece(state.board, state.current, 0, 1);
  return current ? unchanged({ ...state, current }) : landAndSpawn(state);
}

export function applyAction(state, action) {
  if (action === 'pause') return unchanged({ ...state, paused: !state.paused });
  if (state.paused || state.over || state.current === null) return unchanged(state);
  if (action === 'down') return fallOne({ ...state, elapsedMs: 0 });
  let current;
  switch (action) {
    case 'left': current = movePiece(state.board, state.current, -1, 0); break;
    case 'right': current = movePiece(state.board, state.current, 1, 0); break;
    case 'rotL': current = rotatePiece(state.board, state.current, -1); break;
    case 'rotR': current = rotatePiece(state.board, state.current, 1); break;
    default: return unchanged(state);
  }
  return current && current !== state.current ? unchanged({ ...state, current }) : unchanged(state);
}

export function tick(state, dtMs) {
  if (state.paused || state.over || state.current === null || !Number.isFinite(dtMs) || dtMs <= 0) {
    return unchanged(state);
  }
  let falling = { ...state, elapsedMs: state.elapsedMs + dtMs };
  while (falling.elapsedMs >= dropInterval(falling)) {
    falling = { ...falling, elapsedMs: falling.elapsedMs - dropInterval(falling) };
    const result = fallOne(falling);
    // A freshly spawned pair starts its own timer; old elapsed time stops here.
    if (result.events.length > 0) return result;
    falling = result.state;
  }
  return unchanged(falling);
}
