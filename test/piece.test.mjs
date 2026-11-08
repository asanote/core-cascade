import test from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, HIDDEN_ROWS, COLOR_COUNT, SPAWN_X, SPAWN_Y } from '../src/logic/constants.mjs';
import { createBoard, cloneBoard } from '../src/logic/board.mjs';
import { createPiece, pieceCells, canPlace, movePiece, rotatePiece } from '../src/logic/piece.mjs';
import { makeRng, randomPair } from '../src/logic/rng.mjs';

test('board dimensions and spawn use the specified coordinates and colors', () => {
  assert.deepEqual([COLS, ROWS, HIDDEN_ROWS, COLOR_COUNT, SPAWN_X, SPAWN_Y], [6, 13, 1, 4, 2, 1]);
  const board = createBoard();
  assert.equal(board.length, 13);
  assert.ok(board.every(row => row.length === 6 && row.every(cell => cell === 0)));
  board[0][0] = 4;
  assert.equal(board[1][0], 0);
  const copy = cloneBoard(board);
  copy[0][0] = 2;
  assert.equal(board[0][0], 4);
  assert.notStrictEqual(copy[1], board[1]);
});

test('spawn cells are axis first at (2,1) and child at (2,0)', () => {
  const colors = [1, 4];
  const piece = createPiece(colors);
  assert.deepEqual(piece, { x: 2, y: 1, rot: 0, colors: [1, 4] });
  assert.deepEqual(pieceCells(piece), [{ x: 2, y: 1, color: 1 }, { x: 2, y: 0, color: 4 }]);
  colors[0] = 3;
  assert.equal(piece.colors[0], 1);
});

test('each rotation puts the child above, right, below, or left of the axis', () => {
  const positions = [[2, 4], [3, 5], [2, 6], [1, 5]];
  for (let rot = 0; rot < 4; rot++) {
    const cells = pieceCells({ ...createPiece([2, 3]), y: 5, rot });
    assert.deepEqual(cells, [
      { x: 2, y: 5, color: 2 },
      { x: positions[rot][0], y: positions[rot][1], color: 3 },
    ]);
  }
});

test('placement rejects occupied axis or child and every board boundary', () => {
  const board = createBoard();
  const p = createPiece([1, 2]);
  assert.equal(canPlace(board, p), true);
  for (const invalid of [{ x: -1 }, { x: 6 }, { y: 0 }, { y: 13 }, { y: 12, rot: 2 }]) {
    assert.equal(canPlace(board, { ...p, ...invalid }), false);
  }
  board[0][2] = 4;
  assert.equal(canPlace(board, p), false);
  board[0][2] = 0;
  board[1][2] = 4;
  assert.equal(canPlace(board, p), false);
});

test('movement returns a new piece, leaves inputs untouched and stops at the floor', () => {
  const board = createBoard();
  const p = createPiece([1, 2]);
  assert.deepEqual(movePiece(board, p, -1, 1), { ...p, x: 1, y: 2 });
  assert.deepEqual(p, { x: 2, y: 1, rot: 0, colors: [1, 2] });
  assert.equal(movePiece(board, { ...p, y: 12 }, 0, 1), null);
  board[2][2] = 3;
  assert.equal(movePiece(board, p, 0, 1), null);
  assert.equal(board[1][2], 0);
});

test('rotation wraps in both directions without moving an unobstructed axis', () => {
  const board = createBoard();
  const p = { ...createPiece([1, 2]), y: 5 };
  assert.deepEqual(rotatePiece(board, p, -1), { ...p, rot: 3 });
  assert.deepEqual(rotatePiece(board, { ...p, rot: 3 }, 1), p);
  assert.equal(p.rot, 0);
});

test('left-wall counterclockwise rotation kicks one cell right', () => {
  const p = { ...createPiece([1, 2]), x: 0 };
  assert.deepEqual(rotatePiece(createBoard(), p, -1), { ...p, x: 1, rot: 3 });
});

test('right-wall clockwise rotation kicks one cell left', () => {
  const p = { ...createPiece([1, 2]), x: 5 };
  assert.deepEqual(rotatePiece(createBoard(), p, 1), { ...p, x: 4, rot: 1 });
});

test('rotation beside a stack prefers the opposite-child kick before the upward kick', () => {
  const board = createBoard();
  board[5][3] = 4;
  const p = { ...createPiece([1, 2]), y: 5 };
  assert.deepEqual(rotatePiece(board, p, 1), { ...p, x: 1, rot: 1 });
});

test('rotation tries upward from the original axis after an opposite-child kick fails', () => {
  const board = createBoard();
  board[5][1] = board[5][3] = 4;
  const p = { ...createPiece([1, 2]), y: 5 };
  assert.deepEqual(rotatePiece(board, p, 1), { ...p, y: 4, rot: 1 });
});

test('rotation retains the original piece when all three candidates are blocked', () => {
  const board = createBoard();
  board[5][1] = board[5][3] = board[4][3] = 4;
  const p = { ...createPiece([1, 2]), y: 5 };
  assert.strictEqual(rotatePiece(board, p, 1), p);
});

test('floor and ceiling kicks use the direction opposite the rotated child', () => {
  const board = createBoard();
  const floor = { ...createPiece([1, 2]), y: 12, rot: 1 };
  assert.deepEqual(rotatePiece(board, floor, 1), { ...floor, y: 11, rot: 2 });
  const ceiling = { ...createPiece([1, 2]), y: 0, rot: 1 };
  assert.deepEqual(rotatePiece(board, ceiling, -1), { ...ceiling, y: 1, rot: 0 });
});

test('mulberry32 matches a known seed sequence and is reproducible', () => {
  const a = makeRng(1);
  const b = makeRng(1);
  const expected = [2693262067, 11749833, 2265367787, 4213581821, 4159151403];
  assert.deepEqual(expected.map(() => a() * 4294967296), expected);
  assert.deepEqual(expected.map(() => b() * 4294967296), expected);
});

test('random pairs map the full rng range to colors 1 through 4', () => {
  const samples = [0, 0.249999, 0.25, 0.499999, 0.5, 0.749999, 0.75, 0.999999];
  const rng = () => samples.shift();
  assert.deepEqual([randomPair(rng), randomPair(rng), randomPair(rng), randomPair(rng)],
    [[1, 1], [2, 2], [3, 3], [4, 4]]);
});
