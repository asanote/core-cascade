import { COLS, ROWS, HIDDEN_ROWS } from './constants.mjs';
import { createBoard, cloneBoard } from './board.mjs';
import { pieceCells } from './piece.mjs';
import { scoreFor } from './score.mjs';

export function applyGravity(board) {
  const result = createBoard();
  for (let x = 0; x < COLS; x++) {
    let destination = ROWS - 1;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y][x] !== 0) result[destination--][x] = board[y][x];
    }
  }
  return result;
}

export function lockPiece(board, piece) {
  const result = cloneBoard(board);
  for (const { x, y, color } of pieceCells(piece)) result[y][x] = color;
  return applyGravity(result);
}

export function findGroups(board) {
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const groups = [];
  for (let y = HIDDEN_ROWS; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const color = board[y][x];
      if (color === 0 || visited[y][x]) continue;
      const group = [{ x, y }];
      visited[y][x] = true;
      for (let i = 0; i < group.length; i++) {
        const cell = group[i];
        for (const [nx, ny] of [
          [cell.x - 1, cell.y], [cell.x + 1, cell.y],
          [cell.x, cell.y - 1], [cell.x, cell.y + 1],
        ]) {
          if (nx < 0 || nx >= COLS || ny < HIDDEN_ROWS || ny >= ROWS) continue;
          if (visited[ny][nx] || board[ny][nx] !== color) continue;
          visited[ny][nx] = true;
          group.push({ x: nx, y: ny });
        }
      }
      if (group.length >= 4) groups.push(group);
    }
  }
  return groups;
}

export function resolveChains(board) {
  let result = cloneBoard(board);
  const steps = [];
  let totalScore = 0;
  for (let chain = 1; ; chain++) {
    const groups = findGroups(result);
    if (groups.length === 0) break;
    let cleared = 0;
    for (const group of groups) {
      for (const { x, y } of group) {
        result[y][x] = 0;
        cleared++;
      }
    }
    const score = scoreFor(cleared, chain);
    steps.push({ chain, cleared, score, groups });
    totalScore += score;
    result = applyGravity(result);
  }
  return { board: result, steps, totalScore };
}
