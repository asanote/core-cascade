import { COLS, ROWS } from './constants.mjs';

export function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

export function cloneBoard(board) {
  return board.map(row => [...row]);
}
