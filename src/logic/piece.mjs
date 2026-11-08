import { COLS, ROWS, SPAWN_X, SPAWN_Y } from './constants.mjs';

const OFFSETS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function createPiece(colors) {
  return { x: SPAWN_X, y: SPAWN_Y, rot: 0, colors: [...colors] };
}

export function pieceCells(piece) {
  const [dx, dy] = OFFSETS[piece.rot];
  return [
    { x: piece.x, y: piece.y, color: piece.colors[0] },
    { x: piece.x + dx, y: piece.y + dy, color: piece.colors[1] },
  ];
}

export function canPlace(board, piece) {
  return pieceCells(piece).every(({ x, y }) =>
    x >= 0 && x < COLS && y >= 0 && y < ROWS && board[y][x] === 0);
}

export function movePiece(board, piece, dx, dy) {
  const moved = { ...piece, x: piece.x + dx, y: piece.y + dy };
  return canPlace(board, moved) ? moved : null;
}

export function rotatePiece(board, piece, dir) {
  const rotated = { ...piece, rot: (piece.rot + dir + 4) % 4 };
  const [dx, dy] = OFFSETS[rotated.rot];
  // Both kicks are relative to the unshifted, rotated pair.
  return movePiece(board, rotated, 0, 0)
    ?? movePiece(board, rotated, -dx, -dy)
    ?? movePiece(board, rotated, 0, -1)
    ?? piece;
}
