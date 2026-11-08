import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, cloneBoard } from '../src/logic/board.mjs';
import { createPiece } from '../src/logic/piece.mjs';
import { lockPiece, applyGravity, findGroups, resolveChains } from '../src/logic/resolve.mjs';
import { chainMultiplier, scoreFor } from '../src/logic/score.mjs';

test('locking a pair supported on one side drops the unsupported core to the floor', () => {
  const board = createBoard();
  board[11][2] = 3;
  board[12][2] = 4;
  const before = cloneBoard(board);
  const p = { ...createPiece([1, 2]), y: 10, rot: 1 };
  const result = lockPiece(board, p);
  assert.equal(result[10][2], 1);
  assert.equal(result[12][3], 2);
  assert.equal(result[10][3], 0);
  assert.deepEqual(board, before);
  assert.equal(p.y, 10);
});

test('gravity compacts each column stably, including cores falling from the hidden row', () => {
  const board = createBoard();
  board[0][0] = 1;
  board[5][0] = 2;
  board[12][0] = 3;
  board[2][5] = 4;
  const before = cloneBoard(board);
  const result = applyGravity(board);
  const expected = createBoard();
  expected[10][0] = 1;
  expected[11][0] = 2;
  expected[12][0] = 3;
  expected[12][5] = 4;
  assert.deepEqual(result, expected);
  assert.deepEqual(board, before);
  assert.deepEqual(applyGravity(result), result);
});

test('four horizontal cores clear for 40 points with coordinates for animation', () => {
  const board = createBoard();
  board[12] = [1, 1, 1, 1, 0, 0];
  const result = resolveChains(board);
  assert.deepEqual(result.board, createBoard());
  assert.equal(result.totalScore, 40);
  assert.equal(result.steps.length, 1);
  const [step] = result.steps;
  assert.deepEqual({ chain: step.chain, cleared: step.cleared, score: step.score },
    { chain: 1, cleared: 4, score: 40 });
  assert.deepEqual(step.groups[0].map(c => `${c.x},${c.y}`).sort(), ['0,12', '1,12', '2,12', '3,12']);
  assert.deepEqual(board[12], [1, 1, 1, 1, 0, 0]);
});

test('three connected cores do not clear', () => {
  const board = createBoard();
  board[12] = [2, 2, 2, 0, 0, 0];
  assert.deepEqual(findGroups(board), []);
  const result = resolveChains(board);
  assert.deepEqual(result, { board, steps: [], totalScore: 0 });
  result.board[12][0] = 4;
  assert.equal(board[12][0], 2);
});

test('clearing a vertical support creates a second chain worth 80, for 120 total', () => {
  const board = createBoard();
  for (let y = 9; y <= 12; y++) board[y][0] = 1;
  board[8][0] = 2;
  board[12][1] = board[12][2] = board[12][3] = 2;
  const before = cloneBoard(board);
  const result = resolveChains(board);
  assert.deepEqual(result.steps.map(({ chain, cleared, score }) => ({ chain, cleared, score })),
    [{ chain: 1, cleared: 4, score: 40 }, { chain: 2, cleared: 4, score: 80 }]);
  assert.equal(result.totalScore, 40 + 80);
  assert.deepEqual(result.board, createBoard());
  assert.deepEqual(board, before);
  assert.deepEqual(result.steps[1].groups[0].map(c => `${c.x},${c.y}`).sort(),
    ['0,12', '1,12', '2,12', '3,12']);
});

test('the hidden row cannot contribute a fourth core or itself be a clearing group', () => {
  const board = createBoard();
  for (let y = 0; y <= 3; y++) board[y][0] = 1;
  assert.deepEqual(findGroups(board), []);
  assert.deepEqual(resolveChains(board), { board, steps: [], totalScore: 0 });
  const hidden = createBoard();
  hidden[0] = [2, 2, 2, 2, 2, 2];
  assert.deepEqual(findGroups(hidden), []);
  assert.deepEqual(resolveChains(hidden).board, hidden);
});

test('diagonal and different-color neighbors do not connect', () => {
  const board = createBoard();
  board[9][0] = board[10][1] = board[11][2] = board[12][3] = 1;
  board[12][0] = board[12][1] = 2;
  assert.deepEqual(findGroups(board), []);
});

test('a branched group of five clears each cell exactly once', () => {
  const board = createBoard();
  for (const [x, y] of [[2, 10], [1, 11], [2, 11], [3, 11], [2, 12]]) board[y][x] = 3;
  const result = resolveChains(board);
  assert.equal(result.steps[0].groups.length, 1);
  assert.equal(result.steps[0].cleared, 5);
  assert.equal(result.totalScore, 50);
  assert.deepEqual(result.board, createBoard());
});

test('separate qualifying groups clear simultaneously at the same chain multiplier', () => {
  const board = createBoard();
  for (let y = 9; y <= 12; y++) {
    board[y][0] = 1;
    board[y][5] = 4;
  }
  const result = resolveChains(board);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].groups.length, 2);
  assert.equal(result.steps[0].cleared, 8);
  assert.equal(result.totalScore, 80);
});

test('chain multipliers double from one and cap at 64', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 10].map(chainMultiplier),
    [1, 2, 4, 8, 16, 32, 64, 64, 64]);
  assert.equal(scoreFor(4, 1), 40);
  assert.equal(scoreFor(4, 2), 80);
  assert.equal(scoreFor(5, 10), 3200);
});
