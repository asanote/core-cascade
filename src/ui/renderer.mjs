import { COLS, ROWS, HIDDEN_ROWS, SPAWN_X, SPAWN_Y } from '../logic/constants.mjs';
import { cloneBoard } from '../logic/board.mjs';
import { pieceCells, movePiece } from '../logic/piece.mjs';
import { applyGravity } from '../logic/resolve.mjs';
import { dropInterval } from '../logic/game.mjs';

export const LOGICAL_WIDTH = 560;
export const LOGICAL_HEIGHT = 640;

export const CLEAR_FLASH_MS = 260;
export const CLEAR_SETTLE_MS = 120;
export const CLEAR_STAGE_MS = CLEAR_FLASH_MS + CLEAR_SETTLE_MS;
export const CHAIN_POPUP_MS = 1200;

export const CORE_PALETTE = {
  1: {
    name: 'CYAN',
    primary: '#00f0ff',
    secondary: '#0077b6',
    inner: '#d8fcff',
    glow: 'rgba(0, 240, 255, 0.75)',
    shape: 'triangle',
  },
  2: {
    name: 'AMBER',
    primary: '#ffb703',
    secondary: '#c85a00',
    inner: '#fff3c4',
    glow: 'rgba(255, 183, 3, 0.75)',
    shape: 'diamond',
  },
  3: {
    name: 'CRIMSON',
    primary: '#ff2a85',
    secondary: '#9b0047',
    inner: '#ffd6e7',
    glow: 'rgba(255, 42, 133, 0.75)',
    shape: 'star',
  },
  4: {
    name: 'EMERALD',
    primary: '#00f59b',
    secondary: '#007f4f',
    inner: '#d4ffee',
    glow: 'rgba(0, 245, 155, 0.75)',
    shape: 'hex',
  },
};

export function computeGhostCells(board, piece) {
  if (!board || !piece) return [];
  let dropped = piece;
  while (true) {
    const next = movePiece(board, dropped, 0, 1);
    if (!next) break;
    dropped = next;
  }
  const rawCells = pieceCells(dropped);
  const byCol = new Map();
  for (const cell of rawCells) {
    if (!byCol.has(cell.x)) byCol.set(cell.x, []);
    byCol.get(cell.x).push(cell);
  }
  const landed = [];
  for (const [x, colCells] of byCol.entries()) {
    const sorted = [...colCells].sort((a, b) => a.y - b.y);
    let idx = sorted.length - 1;
    let destination = ROWS - 1;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (idx >= 0 && sorted[idx].y === y) {
        landed.push({ x, y: destination--, color: sorted[idx].color });
        idx--;
      } else if (board[y][x] !== 0) {
        destination--;
      }
    }
  }
  return landed;
}

export function buildClearStages(prevState, nextState, events = []) {
  if (!events || events.length === 0) return [];
  let workingBoard = cloneBoard(prevState.board);
  let runningScore = prevState.score ?? 0;
  let runningMaxChain = prevState.maxChain ?? 0;
  let hudNext = prevState.next ? [...prevState.next] : [1, 1];
  const stages = [];

  for (const event of events) {
    if (!event) continue;
    if (event.type === 'lock') {
      if (event.board) {
        workingBoard = cloneBoard(event.board);
      }
    } else if (event.type === 'clear' && event.step) {
      const { chain, cleared, score, groups } = event.step;
      const preBoard = cloneBoard(workingBoard);
      const flashCells = [];
      for (const group of groups) {
        for (const { x, y } of group) {
          const color = preBoard[y]?.[x] || 1;
          flashCells.push({ x, y, color });
          workingBoard[y][x] = 0;
        }
      }
      workingBoard = applyGravity(workingBoard);
      const postBoard = cloneBoard(workingBoard);
      runningScore += score;
      runningMaxChain = Math.max(runningMaxChain, chain);
      stages.push({
        chain,
        cleared,
        stepScore: score,
        score: runningScore,
        maxChain: runningMaxChain,
        next: [...hudNext],
        preBoard,
        postBoard,
        flashCells,
        elapsedMs: 0,
        flashMs: CLEAR_FLASH_MS,
        durationMs: CLEAR_STAGE_MS,
      });
    } else if (event.type === 'spawn') {
      hudNext = nextState?.next ? [...nextState.next] : hudNext;
    }
  }
  return stages;
}

export function getRenderView(state, anim = {}) {
  const activeStage = anim?.stages?.[0] ?? null;
  if (activeStage) {
    const flashMs = activeStage.flashMs ?? CLEAR_FLASH_MS;
    const inFlash = activeStage.elapsedMs < flashMs;
    return {
      board: inFlash ? activeStage.preBoard : activeStage.postBoard,
      current: null,
      next: activeStage.next ?? state.next,
      score: activeStage.score,
      maxChain: activeStage.maxChain,
      lastChain: activeStage.chain,
      over: false,
      paused: Boolean(state.paused),
      flashCells: inFlash ? activeStage.flashCells : [],
      flashProgress: inFlash ? Math.min(1, activeStage.elapsedMs / Math.max(1, flashMs)) : 1,
      chainPopup: {
        chain: activeStage.chain,
        score: activeStage.stepScore ?? 0,
        alpha: 1,
      },
      animatingClear: true,
    };
  }

  let chainPopup = null;
  if (anim?.chainPopup && anim.chainPopup.remainingMs > 0) {
    chainPopup = {
      chain: anim.chainPopup.chain,
      score: anim.chainPopup.score ?? 0,
      alpha: Math.min(1, anim.chainPopup.remainingMs / 280),
    };
  } else if (typeof anim?.chain === 'number' && anim.chain > 0) {
    chainPopup = {
      chain: anim.chain,
      score: anim.stepScore ?? 0,
      alpha: 1,
    };
  }

  return {
    board: state.board,
    current: state.current,
    next: state.next,
    score: state.score,
    maxChain: state.maxChain,
    lastChain: state.lastChain,
    over: Boolean(state.over),
    paused: Boolean(state.paused),
    flashCells: anim?.flashCells ?? anim?.clearing ?? [],
    flashProgress: anim?.flashProgress ?? 0.5,
    chainPopup,
    animatingClear: false,
  };
}

function drawPolygon(ctx, cx, cy, radius, sides, rotation = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i * Math.PI * 2) / sides;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawRoundedPanel(ctx, x, y, w, h, r = 8) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawGeometricCore(ctx, cx, cy, cellSize, colorId, options = {}) {
  const palette = CORE_PALETTE[colorId] ?? CORE_PALETTE[1];
  const radius = cellSize * 0.41;
  const { isAxis = false, isGhost = false, isFlashing = false, flashProgress = 0 } = options;

  ctx.save();

  if (isGhost) {
    ctx.globalAlpha = 0.36;
    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = 2;
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([4, 3]);
    drawPolygon(ctx, cx, cy, radius * 0.9, 6, -Math.PI / 2);
    ctx.stroke();
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
    drawPolygon(ctx, cx, cy, radius * 0.38, 6, -Math.PI / 2);
    ctx.fillStyle = palette.primary;
    ctx.fill();
    ctx.restore();
    return;
  }

  // Outer glow
  ctx.shadowColor = isFlashing ? '#ffffff' : palette.primary;
  ctx.shadowBlur = isFlashing ? 22 : 12;

  // Outer hexagonal shell
  drawPolygon(ctx, cx, cy, radius, 6, -Math.PI / 2);
  if (typeof ctx.createRadialGradient === 'function') {
    const grad = ctx.createRadialGradient(cx - radius * 0.2, cy - radius * 0.2, radius * 0.1, cx, cy, radius);
    if (isFlashing) {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.65, '#ffffff');
      grad.addColorStop(1, palette.primary);
    } else {
      grad.addColorStop(0, palette.inner);
      grad.addColorStop(0.45, palette.primary);
      grad.addColorStop(1, palette.secondary);
    }
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = isFlashing ? '#ffffff' : palette.primary;
  }
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = isFlashing ? 2.6 : 1.8;
  ctx.strokeStyle = isFlashing ? '#ffffff' : palette.inner;
  ctx.stroke();

  // Inner geometric facet (distinct per color, purely geometric, no faces)
  const innerR = radius * 0.54;
  ctx.strokeStyle = isFlashing ? palette.primary : '#091024';
  ctx.lineWidth = 1.6;
  if (palette.shape === 'triangle') {
    drawPolygon(ctx, cx, cy, innerR, 3, -Math.PI / 2);
    ctx.stroke();
  } else if (palette.shape === 'diamond') {
    drawPolygon(ctx, cx, cy, innerR, 4, 0);
    ctx.stroke();
  } else if (palette.shape === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    }
    ctx.stroke();
  } else {
    drawPolygon(ctx, cx, cy, innerR, 6, 0);
    ctx.stroke();
  }

  // Center energy point
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Axis ring marker for the active controllable pair
  if (isAxis) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.4;
    drawPolygon(ctx, cx, cy, radius * 1.12, 6, -Math.PI / 2);
    ctx.stroke();
  }

  // Flash shockwave ring
  if (isFlashing) {
    const pulseR = radius * (1.1 + 0.45 * Math.sin(flashProgress * Math.PI));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.4;
    drawPolygon(ctx, cx, cy, pulseR, 6, -Math.PI / 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawBoardConnections(ctx, board, boardX, boardY, cellSize) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let y = HIDDEN_ROWS; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const color = board[y]?.[x] ?? 0;
      if (!color) continue;
      const palette = CORE_PALETTE[color] ?? CORE_PALETTE[1];
      const cx = boardX + (x + 0.5) * cellSize;
      const cy = boardY + (y - HIDDEN_ROWS + 0.5) * cellSize;

      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        if (nx < COLS && ny < ROWS && board[ny]?.[nx] === color) {
          const ncx = boardX + (nx + 0.5) * cellSize;
          const ncy = boardY + (ny - HIDDEN_ROWS + 0.5) * cellSize;
          ctx.strokeStyle = palette.glow;
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(ncx, ncy);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

export function drawGame(ctx, state, anim = {}) {
  if (!ctx || !state) return;
  const width = LOGICAL_WIDTH;
  const height = LOGICAL_HEIGHT;
  const actualW = ctx.canvas?.width ?? LOGICAL_WIDTH;
  const actualH = ctx.canvas?.height ?? LOGICAL_HEIGHT;
  const view = getRenderView(state, anim);

  const visibleRows = ROWS - HIDDEN_ROWS;
  const cellSize = 44;
  const boardW = COLS * cellSize;
  const boardH = visibleRows * cellSize;
  const boardX = 36;
  const boardY = 76;
  const hudX = boardX + boardW + 26;
  const hudW = width - hudX - 28;

  ctx.save();
  if ((actualW !== LOGICAL_WIDTH || actualH !== LOGICAL_HEIGHT) && typeof ctx.scale === 'function') {
    ctx.scale(actualW / LOGICAL_WIDTH, actualH / LOGICAL_HEIGHT);
  }

  // 1. Deep space geometric background
  ctx.fillStyle = '#060913';
  ctx.fillRect(0, 0, width, height);

  if (typeof ctx.createLinearGradient === 'function') {
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#070b18');
    bgGrad.addColorStop(0.5, '#0b1328');
    bgGrad.addColorStop(1, '#050811');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);
  }

  // Title header
  ctx.fillStyle = '#00f0ff';
  ctx.font = 'bold 24px "Segoe UI", "Consolas", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('CORE CASCADE', boardX, 40);

  ctx.fillStyle = '#6c84b8';
  ctx.font = '12px "Segoe UI", "Consolas", monospace';
  ctx.fillText('GEOMETRIC RESONANCE MATRIX', boardX + 215, 42);

  // 2. Playfield frame and grid (visible rows y = 1..12 only; y = 0 hidden row is never drawn)
  drawRoundedPanel(ctx, boardX - 4, boardY - 4, boardW + 8, boardH + 8, 10);
  ctx.fillStyle = '#090e1d';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1f325c';
  ctx.stroke();

  ctx.strokeStyle = 'rgba(42, 71, 128, 0.28)';
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    const gx = boardX + x * cellSize;
    ctx.beginPath();
    ctx.moveTo(gx, boardY);
    ctx.lineTo(gx, boardY + boardH);
    ctx.stroke();
  }
  for (let r = 1; r < visibleRows; r++) {
    const gy = boardY + r * cellSize;
    ctx.beginPath();
    ctx.moveTo(boardX, gy);
    ctx.lineTo(boardX + boardW, gy);
    ctx.stroke();
  }

  // Danger line indicator at row y = 4 (visible row index 4 - HIDDEN_ROWS + 1 = 4)
  const dangerY = boardY + (4 - HIDDEN_ROWS + 1) * cellSize;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 42, 133, 0.22)';
  ctx.lineWidth = 1;
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(boardX, dangerY);
  ctx.lineTo(boardX + boardW, dangerY);
  ctx.stroke();
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
  ctx.restore();

  // Spawn marker at (SPAWN_X=2, SPAWN_Y=1)
  const spawnCx = boardX + (SPAWN_X + 0.5) * cellSize;
  const spawnCy = boardY + (SPAWN_Y - HIDDEN_ROWS + 0.5) * cellSize;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 70, 120, 0.35)';
  ctx.lineWidth = 1.5;
  drawPolygon(ctx, spawnCx, spawnCy, cellSize * 0.24, 6, 0);
  ctx.stroke();
  ctx.restore();

  // 3. Settled board connections & cores (strictly y >= HIDDEN_ROWS)
  drawBoardConnections(ctx, view.board, boardX, boardY, cellSize);

  const flashSet = new Set(
    (view.flashCells || []).map(cell => `${cell.x},${cell.y}`)
  );

  for (let y = HIDDEN_ROWS; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const color = view.board[y]?.[x] ?? 0;
      if (!color) continue;
      const cx = boardX + (x + 0.5) * cellSize;
      const cy = boardY + (y - HIDDEN_ROWS + 0.5) * cellSize;
      const isFlashing = flashSet.has(`${x},${y}`);
      drawGeometricCore(ctx, cx, cy, cellSize, color, {
        isFlashing,
        flashProgress: view.flashProgress,
      });
    }
  }

  // 4. Ghost landing preview & active falling pair
  if (view.current && !view.over && !view.animatingClear) {
    const activeCells = pieceCells(view.current);
    const ghostCells = computeGhostCells(view.board, view.current);

    for (const ghost of ghostCells) {
      if (ghost.y < HIDDEN_ROWS) continue;
      const overlapsActive = activeCells.some(c => c.x === ghost.x && c.y === ghost.y);
      if (overlapsActive) continue;
      const cx = boardX + (ghost.x + 0.5) * cellSize;
      const cy = boardY + (ghost.y - HIDDEN_ROWS + 0.5) * cellSize;
      drawGeometricCore(ctx, cx, cy, cellSize, ghost.color, { isGhost: true });
    }

    activeCells.forEach((cell, index) => {
      if (cell.y < HIDDEN_ROWS) return;
      const cx = boardX + (cell.x + 0.5) * cellSize;
      const cy = boardY + (cell.y - HIDDEN_ROWS + 0.5) * cellSize;
      drawGeometricCore(ctx, cx, cy, cellSize, cell.color, { isAxis: index === 0 });
    });
  }

  // 5. Right HUD panels
  // NEXT PAIR panel
  const nextY = boardY;
  const nextH = 122;
  drawRoundedPanel(ctx, hudX, nextY, hudW, nextH, 8);
  ctx.fillStyle = '#0b1224';
  ctx.fill();
  ctx.strokeStyle = '#1f325c';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#7f99cc';
  ctx.font = 'bold 12px "Segoe UI", "Consolas", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('NEXT PAIR', hudX + 14, nextY + 18);

  if (Array.isArray(view.next) && view.next.length >= 2) {
    const previewCx = hudX + hudW / 2;
    // child (next[1]) spawns above axis (next[0])
    drawGeometricCore(ctx, previewCx, nextY + 52, 36, view.next[1], {});
    drawGeometricCore(ctx, previewCx, nextY + 93, 36, view.next[0], { isAxis: true });
  }

  // SCORE panel
  const scoreY = nextY + nextH + 10;
  const scoreH = 82;
  drawRoundedPanel(ctx, hudX, scoreY, hudW, scoreH, 8);
  ctx.fillStyle = '#0b1224';
  ctx.fill();
  ctx.strokeStyle = '#1f325c';
  ctx.stroke();

  ctx.fillStyle = '#7f99cc';
  ctx.font = 'bold 12px "Segoe UI", "Consolas", monospace';
  ctx.fillText('SCORE', hudX + 14, scoreY + 18);

  ctx.fillStyle = '#eaf4ff';
  ctx.font = 'bold 24px "Consolas", "Segoe UI", monospace';
  ctx.fillText(String(view.score ?? 0).padStart(6, '0'), hudX + 14, scoreY + 45);

  const speedMs = dropInterval({ score: view.score ?? 0 });
  ctx.fillStyle = '#5875a8';
  ctx.font = '11px "Consolas", "Segoe UI", monospace';
  ctx.fillText(`DROP INTERVAL: ${speedMs}ms`, hudX + 14, scoreY + 68);

  // CHAIN panel
  const chainY = scoreY + scoreH + 10;
  const chainH = 86;
  drawRoundedPanel(ctx, hudX, chainY, hudW, chainH, 8);
  ctx.fillStyle = '#0b1224';
  ctx.fill();
  ctx.strokeStyle = view.lastChain > 0 ? '#00f0ff' : '#1f325c';
  ctx.stroke();

  ctx.fillStyle = '#7f99cc';
  ctx.font = 'bold 12px "Segoe UI", "Consolas", monospace';
  ctx.fillText('MAX CHAIN', hudX + 14, chainY + 18);

  ctx.fillStyle = '#ffb703';
  ctx.font = 'bold 22px "Consolas", "Segoe UI", monospace';
  ctx.fillText(`${view.maxChain ?? 0}`, hudX + 14, chainY + 44);

  const activeChainCount = view.chainPopup?.chain ?? (view.lastChain > 0 ? view.lastChain : 0);
  if (activeChainCount > 0) {
    ctx.fillStyle = activeChainCount >= 2 ? '#ff2a85' : '#00f0ff';
    ctx.font = 'bold 15px "Consolas", "Segoe UI", monospace';
    ctx.fillText(`${activeChainCount} CHAIN`, hudX + 14, chainY + 70);
  } else {
    ctx.fillStyle = '#48608f';
    ctx.font = '12px "Consolas", "Segoe UI", monospace';
    ctx.fillText('READY', hudX + 14, chainY + 70);
  }

  // CONTROLS panel (Keyboard + Gamepad standard bindings)
  const ctrlY = chainY + chainH + 10;
  const ctrlH = boardY + boardH - ctrlY;
  drawRoundedPanel(ctx, hudX, ctrlY, hudW, ctrlH, 8);
  ctx.fillStyle = '#0b1224';
  ctx.fill();
  ctx.strokeStyle = '#1f325c';
  ctx.stroke();

  ctx.fillStyle = '#7f99cc';
  ctx.font = 'bold 11px "Segoe UI", "Consolas", monospace';
  ctx.fillText('CONTROLS (KEY / PAD)', hudX + 12, ctrlY + 18);

  const controls = [
    ['←→ / D-Pad,LS', 'MOVE'],
    ['↓ / Down,LS', 'DROP'],
    ['Z,X / B,A(A,B)', 'ROT L/R'],
    ['P / + (Menu)', 'PAUSE'],
    ['R / - (View)', 'RESTART'],
    ['M / Y (X)', 'BGM'],
    ['F / Button', 'FULLSCR'],
  ];
  ctx.font = '11px "Consolas", "Segoe UI", monospace';
  controls.forEach(([key, desc], idx) => {
    const rowY = ctrlY + 40 + idx * 23;
    ctx.fillStyle = '#00f0ff';
    ctx.fillText(key, hudX + 12, rowY);
    ctx.fillStyle = '#a9bee8';
    ctx.fillText(desc, hudX + 122, rowY);
  });

  // 6. Floating "N CHAIN" popup on the playfield
  if (view.chainPopup && view.chainPopup.chain >= 1 && !view.over) {
    ctx.save();
    ctx.globalAlpha = view.chainPopup.alpha ?? 1;
    const bannerW = 210;
    const bannerH = 54;
    const bannerX = boardX + (boardW - bannerW) / 2;
    const bannerY = boardY + 95;

    drawRoundedPanel(ctx, bannerX, bannerY, bannerW, bannerH, 10);
    ctx.fillStyle = 'rgba(8, 15, 34, 0.92)';
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = view.chainPopup.chain >= 2 ? '#ff2a85' : '#00f0ff';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = view.chainPopup.chain >= 2 ? '#ff7aa8' : '#00f0ff';
    ctx.font = 'bold 24px "Segoe UI", "Consolas", monospace';
    ctx.fillText(`${view.chainPopup.chain} CHAIN!`, bannerX + bannerW / 2, bannerY + 24);

    if (view.chainPopup.score > 0) {
      ctx.fillStyle = '#ffe169';
      ctx.font = 'bold 12px "Consolas", "Segoe UI", monospace';
      ctx.fillText(`+${view.chainPopup.score} PTS`, bannerX + bannerW / 2, bannerY + 42);
    }
    ctx.restore();
  }

  // 7. PAUSED / GAME OVER overlays (GAME OVER only after clear animations finish)
  if (view.over || view.paused) {
    ctx.save();
    ctx.fillStyle = 'rgba(4, 7, 16, 0.78)';
    ctx.fillRect(boardX, boardY, boardW, boardH);

    const boxW = 228;
    const boxH = 116;
    const boxX = boardX + (boardW - boxW) / 2;
    const boxY = boardY + (boardH - boxH) / 2;

    drawRoundedPanel(ctx, boxX, boxY, boxW, boxH, 10);
    ctx.fillStyle = '#0c152c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = view.over ? '#ff2a85' : '#00f0ff';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = view.over ? '#ff2a85' : '#00f0ff';
    ctx.font = 'bold 26px "Segoe UI", "Consolas", monospace';
    ctx.fillText(view.over ? 'GAME OVER' : 'PAUSED', boxX + boxW / 2, boxY + 44);

    ctx.fillStyle = '#c5d7f7';
    ctx.font = '13px "Consolas", "Segoe UI", monospace';
    ctx.fillText(
      view.over ? 'PRESS R / - TO RESTART' : 'PRESS P / + TO RESUME',
      boxX + boxW / 2,
      boxY + 80
    );
    ctx.restore();
  }

  ctx.restore();
}
