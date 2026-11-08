import { createGame, applyAction, tick, dropInterval } from '../logic/game.mjs';
import {
  drawGame,
  buildClearStages,
  getRenderView,
  CHAIN_POPUP_MS,
  LOGICAL_WIDTH,
  LOGICAL_HEIGHT,
} from './renderer.mjs';
import { bindKeys } from './input.mjs';
import {
  playActionSound,
  playEventSound,
  unlockAudio,
  isAudioUnlocked,
  isBgmEnabled,
  toggleBgm,
  restartBgm,
  syncBgmWithGameState,
  getBgmState,
} from './audio.mjs';
import {
  createGamepadTracker,
  pollNavigatorGamepads,
} from './gamepad.mjs';

const MAX_TRACK_QUEUE = 64;
const pendingTrackByWin = new WeakMap();

function getTrackQueue(win) {
  if (!win || (typeof win !== 'object' && typeof win !== 'function')) return null;
  let q = pendingTrackByWin.get(win);
  if (!q) {
    q = [];
    pendingTrackByWin.set(win, q);
  }
  return q;
}

export function flushTrackQueue(win = typeof window !== 'undefined' ? window : null) {
  try {
    if (!win || !win.goatcounter || typeof win.goatcounter.count !== 'function') {
      return false;
    }
    const q = pendingTrackByWin.get(win);
    if (!q || q.length === 0) return true;
    while (q.length > 0) {
      const item = q.shift();
      win.goatcounter.count(item);
    }
    return true;
  } catch {
    return false;
  }
}

export function track(path, title) {
  try {
    if (typeof window === 'undefined' || !window) return;
    const payload = { path: 'cascade-' + path, title, event: true };
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      flushTrackQueue(window);
      window.goatcounter.count(payload);
    } else {
      const q = getTrackQueue(window);
      if (q && q.length < MAX_TRACK_QUEUE) {
        q.push(payload);
      }
    }
  } catch (e) {}
}

export function createAnimState() {
  return {
    stages: [],
    chainPopup: null,
  };
}

export function isAnimatingClear(anim) {
  return Boolean(anim?.stages && anim.stages.length > 0);
}

export function queueEvents(anim, prevState, nextState, events = []) {
  if (!events || events.length === 0) return anim;
  const stages = buildClearStages(prevState, nextState, events);
  if (stages.length > 0) {
    anim.stages.push(...stages);
    const active = anim.stages[0];
    anim.chainPopup = {
      chain: active.chain,
      score: active.stepScore,
      remainingMs: CHAIN_POPUP_MS,
    };
    playEventSound({ type: 'clear', step: { chain: active.chain } });
  } else {
    for (const event of events) {
      playEventSound(event);
    }
  }
  return anim;
}

export function stepAnim(anim, dtMs, paused = false) {
  if (!anim || paused || !Number.isFinite(dtMs) || dtMs <= 0) {
    return isAnimatingClear(anim);
  }
  if (isAnimatingClear(anim)) {
    let remaining = dtMs;
    while (remaining > 0 && anim.stages.length > 0) {
      const current = anim.stages[0];
      const needed = current.durationMs - current.elapsedMs;
      if (remaining >= needed) {
        remaining -= needed;
        const finished = anim.stages.shift();
        if (anim.stages.length > 0) {
          const nextStage = anim.stages[0];
          anim.chainPopup = {
            chain: nextStage.chain,
            score: nextStage.stepScore,
            remainingMs: CHAIN_POPUP_MS,
          };
          playEventSound({ type: 'clear', step: { chain: nextStage.chain } });
        } else {
          anim.chainPopup = {
            chain: finished.chain,
            score: finished.stepScore,
            remainingMs: CHAIN_POPUP_MS,
          };
        }
      } else {
        current.elapsedMs += remaining;
        remaining = 0;
      }
    }
    return true;
  }

  if (anim.chainPopup && anim.chainPopup.remainingMs > 0) {
    anim.chainPopup.remainingMs = Math.max(0, anim.chainPopup.remainingMs - dtMs);
    if (anim.chainPopup.remainingMs === 0) {
      anim.chainPopup = null;
    }
  }
  return false;
}

export function isFullscreenSupported(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !doc.documentElement) return false;
  if (doc.fullscreenEnabled === false || doc.webkitFullscreenEnabled === false) {
    return false;
  }
  const el = doc.documentElement;
  return (
    typeof el.requestFullscreen === 'function' ||
    typeof el.webkitRequestFullscreen === 'function'
  );
}

export function createGameController({
  ctx = null,
  seed = Date.now(),
  statusEl = null,
  onFullscreenToggle = null,
  onExitFullscreen = null,
  onUiSync = null,
} = {}) {
  const controller = {
    ctx,
    statusEl,
    seed,
    state: createGame(seed),
    anim: createAnimState(),
    chain2Tracked: false,
    gameoverTracked: false,
    onFullscreenToggle,
    onExitFullscreen,
    onUiSync,
    trackEvents(events = [], nextState = this.state) {
      for (const ev of events) {
        if (!ev) continue;
        if (ev.type === 'clear' && (ev.step?.chain ?? 0) >= 2 && !this.chain2Tracked) {
          this.chain2Tracked = true;
          track('chain2', '2+ Chain');
        }
        if (ev.type === 'gameover' && !this.gameoverTracked) {
          this.gameoverTracked = true;
          track('gameover', 'Game Over');
        }
      }
      if (nextState?.maxChain >= 2 && !this.chain2Tracked) {
        this.chain2Tracked = true;
        track('chain2', '2+ Chain');
      }
      if (nextState?.over && !this.gameoverTracked) {
        this.gameoverTracked = true;
        track('gameover', 'Game Over');
      }
    },
    render() {
      flushTrackQueue();
      if (this.ctx) {
        drawGame(this.ctx, this.state, this.anim);
      }
      if (this.statusEl) {
        const view = getRenderView(this.state, this.anim);
        if (view.over) {
          this.statusEl.textContent = 'GAME OVER — Press R or Pad (- / View) to Restart';
        } else if (view.paused) {
          this.statusEl.textContent = 'PAUSED — Press P or Pad (+ / Menu) to Resume';
        } else if (view.chainPopup && view.chainPopup.chain >= 1) {
          this.statusEl.textContent = `${view.chainPopup.chain} CHAIN! SCORE ${view.score}`;
        } else {
          this.statusEl.textContent = `SCORE ${view.score} | MAX CHAIN ${view.maxChain} | SPEED ${dropInterval({ score: view.score })}ms`;
        }
      }
      if (typeof this.onUiSync === 'function') {
        this.onUiSync(this);
      }
    },
    dispatch(action) {
      flushTrackQueue();
      if (action === 'bgm') {
        const view = this.getView();
        toggleBgm({ paused: view.paused, over: view.over });
        this.render();
        return this.state;
      }
      if (action === 'fullscreen') {
        if (typeof this.onFullscreenToggle === 'function') {
          this.onFullscreenToggle();
        }
        return this.state;
      }
      if (action === 'exitFullscreen') {
        if (typeof this.onExitFullscreen === 'function') {
          this.onExitFullscreen();
        }
        return this.state;
      }
      if (action === 'restart') {
        this.state = createGame(Date.now());
        this.anim = createAnimState();
        this.chain2Tracked = false;
        this.gameoverTracked = false;
        playActionSound('restart');
        restartBgm();
        syncBgmWithGameState(this.getView());
        track('start', 'Game Start');
        this.render();
        return this.state;
      }
      if (action === 'pause') {
        const result = applyAction(this.state, 'pause');
        this.state = result.state;
        playActionSound('pause');
        syncBgmWithGameState(this.getView());
        this.render();
        return this.state;
      }
      // Freeze gameplay movement/rotation/drop while clear animation stages are active
      if (isAnimatingClear(this.anim)) {
        return this.state;
      }
      const prevState = this.state;
      const result = applyAction(prevState, action);
      this.state = result.state;
      if (result.state !== prevState) {
        playActionSound(action);
      }
      if (result.events.length > 0) {
        queueEvents(this.anim, prevState, result.state, result.events);
        this.trackEvents(result.events, result.state);
      }
      syncBgmWithGameState(this.getView());
      this.render();
      return this.state;
    },
    step(dtMs) {
      flushTrackQueue();
      if (!Number.isFinite(dtMs) || dtMs <= 0) return this.state;
      // Stop advancing game time while a clear animation is active or once one is queued
      if (isAnimatingClear(this.anim)) {
        stepAnim(this.anim, dtMs, this.state.paused);
        syncBgmWithGameState(this.getView());
        this.render();
        return this.state;
      }
      stepAnim(this.anim, dtMs, this.state.paused);
      const prevState = this.state;
      const result = tick(prevState, dtMs);
      this.state = result.state;
      if (result.events.length > 0) {
        queueEvents(this.anim, prevState, result.state, result.events);
        this.trackEvents(result.events, result.state);
      }
      syncBgmWithGameState(this.getView());
      this.render();
      return this.state;
    },
    getView() {
      return getRenderView(this.state, this.anim);
    },
  };

  track('start', 'Game Start');
  syncBgmWithGameState(controller.getView());
  controller.render();
  return controller;
}

export function startApp(rootDoc = typeof document !== 'undefined' ? document : null) {
  if (!rootDoc) return null;
  const canvas = rootDoc.getElementById('game-canvas');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const cabinetEl = rootDoc.getElementById('game-cabinet');
  const statusEl = rootDoc.getElementById('game-status');
  const gestureHintEl = rootDoc.getElementById('gesture-hint');
  const gamepadIndicatorEl = rootDoc.getElementById('gamepad-indicator');
  const bgmBtnEl = rootDoc.getElementById('bgm-btn');
  const fullscreenBtnEl = rootDoc.getElementById('fullscreen-btn');
  const fullscreenNoteEl = rootDoc.getElementById('fullscreen-note');
  const topBarEl = typeof rootDoc.querySelector === 'function' ? rootDoc.querySelector('.top-bar') : null;
  const statusBarEl = typeof rootDoc.querySelector === 'function' ? rootDoc.querySelector('.status-bar') : null;
  const footerEl = typeof rootDoc.querySelector === 'function' ? rootDoc.querySelector('.footer-note') : null;

  let initialSeed = Date.now();
  if (typeof window !== 'undefined' && window.location?.search) {
    const params = new URLSearchParams(window.location.search);
    const parsed = Number(params.get('seed'));
    if (Number.isFinite(parsed) && params.has('seed')) {
      initialSeed = parsed;
    }
  }

  function isFullscreenActive() {
    return Boolean(rootDoc.fullscreenElement || rootDoc.webkitFullscreenElement);
  }

  function measureNonCanvasChrome(inFs) {
    const topBarH = Math.max(28, Math.ceil(topBarEl?.getBoundingClientRect?.().height || topBarEl?.offsetHeight || 28));
    const statusBarH = Math.max(30, Math.ceil(statusBarEl?.getBoundingClientRect?.().height || statusBarEl?.offsetHeight || 30));
    const footerH = inFs
      ? 0
      : Math.max(18, Math.ceil(footerEl?.getBoundingClientRect?.().height || footerEl?.offsetHeight || 18)) + 6;
    // body padding (12) + cabinet padding/border (26) + cabinet 2 flex gaps (16) + breathing room (8)
    const verticalChrome = 12 + 26 + 16 + 8 + topBarH + statusBarH + footerH;
    // body padding (12) + cabinet padding/border (26) + breathing room (8)
    const horizontalChrome = 12 + 26 + 8;
    return { verticalChrome, horizontalChrome, topBarH, footerH };
  }

  function fitLayout() {
    if (typeof window === 'undefined') return;
    const vw = Math.max(240, window.innerWidth || LOGICAL_WIDTH);
    const vh = Math.max(240, window.innerHeight || LOGICAL_HEIGHT);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const inFs = isFullscreenActive();

    if (rootDoc.body) {
      rootDoc.body.classList.toggle('is-fullscreen', inFs);
    }

    const pass1 = measureNonCanvasChrome(inFs);
    const availW = Math.max(180, vw - pass1.horizontalChrome);
    const availH1 = Math.max(180, vh - pass1.verticalChrome);
    const rawScale1 = Math.min(availW / LOGICAL_WIDTH, availH1 / LOGICAL_HEIGHT);
    const scale1 = inFs ? rawScale1 : Math.min(1, rawScale1);

    let displayW = Math.max(140, Math.floor(LOGICAL_WIDTH * scale1));
    let displayH = Math.max(160, Math.floor(LOGICAL_HEIGHT * scale1));

    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;

    // Re-measure in case narrowing the cabinet caused .top-bar or .footer-note to wrap onto multiple lines
    const pass2 = measureNonCanvasChrome(inFs);
    if (pass2.verticalChrome > pass1.verticalChrome) {
      const availH2 = Math.max(180, vh - pass2.verticalChrome);
      const rawScale2 = Math.min(availW / LOGICAL_WIDTH, availH2 / LOGICAL_HEIGHT);
      const scale2 = inFs ? rawScale2 : Math.min(1, rawScale2);
      displayW = Math.max(140, Math.floor(LOGICAL_WIDTH * scale2));
      displayH = Math.max(160, Math.floor(LOGICAL_HEIGHT * scale2));
      canvas.style.width = `${displayW}px`;
      canvas.style.height = `${displayH}px`;
    }

    // Final bounding-box check if DOM layout rects are available
    if (cabinetEl && typeof cabinetEl.getBoundingClientRect === 'function') {
      const cabRect = cabinetEl.getBoundingClientRect();
      const footRect = !inFs && footerEl && typeof footerEl.getBoundingClientRect === 'function'
        ? footerEl.getBoundingClientRect()
        : null;
      const totalBottom = footRect && footRect.height > 0 ? footRect.bottom : cabRect.bottom;
      const totalTop = cabRect.top;
      const usedH = totalBottom - totalTop;
      if (usedH > vh - 8 && displayH > 160) {
        const excess = Math.ceil(usedH - (vh - 8));
        displayH = Math.max(160, displayH - excess);
        displayW = Math.max(140, Math.floor((displayH * LOGICAL_WIDTH) / LOGICAL_HEIGHT));
        canvas.style.width = `${displayW}px`;
        canvas.style.height = `${displayH}px`;
      }
    }

    const targetPixelW = Math.max(140, Math.round(displayW * dpr));
    const targetPixelH = Math.max(160, Math.round(displayH * dpr));

    if (canvas.width !== targetPixelW || canvas.height !== targetPixelH) {
      canvas.width = targetPixelW;
      canvas.height = targetPixelH;
    }
    if (controller) {
      controller.render();
    }
  }

  function updateFullscreenCapability() {
    const supported = isFullscreenSupported(rootDoc);
    if (fullscreenBtnEl) {
      fullscreenBtnEl.hidden = !supported;
    }
    if (fullscreenNoteEl) {
      fullscreenNoteEl.hidden = supported;
    }
  }

  function updateUiControls() {
    if (gestureHintEl) {
      gestureHintEl.hidden = isAudioUnlocked();
    }
    if (bgmBtnEl) {
      const on = isBgmEnabled();
      bgmBtnEl.textContent = on ? 'BGM: ON (M)' : 'BGM: OFF (M)';
      bgmBtnEl.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (fullscreenBtnEl) {
      const inFs = isFullscreenActive();
      fullscreenBtnEl.textContent = inFs ? '全画面解除 (F)' : '全画面 (F)';
      fullscreenBtnEl.setAttribute('aria-pressed', inFs ? 'true' : 'false');
    }
  }

  function syncFullscreenUi() {
    fitLayout();
    updateUiControls();
  }

  function enterFullscreen() {
    if (!isFullscreenSupported(rootDoc)) return;
    const el = rootDoc.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (typeof req !== 'function') return;
    try {
      const res = req.call(el);
      if (res && typeof res.then === 'function') {
        res.then(syncFullscreenUi, syncFullscreenUi);
      }
    } catch {
      syncFullscreenUi();
    }
  }

  function exitFullscreen() {
    if (isFullscreenActive()) {
      const exit = rootDoc.exitFullscreen || rootDoc.webkitExitFullscreen;
      if (typeof exit === 'function') {
        try {
          const res = exit.call(rootDoc);
          if (res && typeof res.then === 'function') {
            res.then(syncFullscreenUi, syncFullscreenUi);
          }
        } catch {
          syncFullscreenUi();
        }
      }
    }
    syncFullscreenUi();
  }

  function toggleFullscreen() {
    if (!isFullscreenSupported(rootDoc)) return;
    if (isFullscreenActive()) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }

  let controller = null;
  controller = createGameController({
    ctx,
    seed: initialSeed,
    statusEl,
    onFullscreenToggle: toggleFullscreen,
    onExitFullscreen: () => {
      if (isFullscreenActive()) {
        exitFullscreen();
      }
    },
    onUiSync: () => {
      updateUiControls();
    },
  });

  updateFullscreenCapability();
  fitLayout();
  updateUiControls();

  // User gesture (key press, click, or tap — NOT gamepad) unlocks/resumes audio and starts BGM
  function handleUserGesture() {
    const firstUnlock = !isAudioUnlocked();
    unlockAudio();
    if (firstUnlock) {
      syncBgmWithGameState(controller.getView());
      updateUiControls();
    }
  }

  const target = typeof window !== 'undefined' ? window : rootDoc;
  if (typeof target.addEventListener === 'function') {
    target.addEventListener('keydown', handleUserGesture, { capture: true });
    target.addEventListener('pointerdown', handleUserGesture, { capture: true, passive: true });
    target.addEventListener('mousedown', handleUserGesture, { capture: true, passive: true });
    target.addEventListener('touchstart', handleUserGesture, { capture: true, passive: true });
    target.addEventListener('click', handleUserGesture, { capture: true, passive: true });
    target.addEventListener('resize', fitLayout);
    target.addEventListener('orientationchange', fitLayout);
    target.addEventListener('load', () => flushTrackQueue());
  }

  const gcScript =
    typeof rootDoc.querySelector === 'function'
      ? rootDoc.querySelector('script[data-goatcounter]')
      : null;
  if (gcScript && typeof gcScript.addEventListener === 'function') {
    gcScript.addEventListener('load', () => flushTrackQueue());
  }

  if (typeof rootDoc.addEventListener === 'function') {
    rootDoc.addEventListener('fullscreenchange', syncFullscreenUi);
    rootDoc.addEventListener('webkitfullscreenchange', syncFullscreenUi);
    rootDoc.addEventListener('fullscreenerror', syncFullscreenUi);
    rootDoc.addEventListener('webkitfullscreenerror', syncFullscreenUi);
  }

  if (bgmBtnEl) {
    bgmBtnEl.addEventListener('click', event => {
      event.preventDefault();
      handleUserGesture();
      controller.dispatch('bgm');
      bgmBtnEl.blur();
    });
  }

  if (fullscreenBtnEl) {
    fullscreenBtnEl.addEventListener('click', event => {
      event.preventDefault();
      handleUserGesture();
      toggleFullscreen();
      fullscreenBtnEl.blur();
    });
  }

  const unbind = bindKeys(target, action => controller.dispatch(action));
  const gamepadTracker = createGamepadTracker();

  function pollGamepad(now = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
    const pads = pollNavigatorGamepads();
    const actions = gamepadTracker.poll(pads, now);
    if (gamepadIndicatorEl) {
      gamepadIndicatorEl.hidden = !gamepadTracker.isConnected();
    }
    for (const action of actions) {
      controller.dispatch(action);
    }
    return actions;
  }

  if (typeof target.addEventListener === 'function') {
    target.addEventListener('gamepadconnected', () => pollGamepad());
    target.addEventListener('gamepaddisconnected', () => pollGamepad());
  }

  let lastTime = null;
  let rafId = null;

  function frame(now) {
    if (lastTime === null) {
      lastTime = now;
    }
    const dtMs = Math.min(100, Math.max(0, now - lastTime));
    lastTime = now;
    pollGamepad(now);
    controller.step(dtMs);
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(frame);
    }
  }

  if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(frame);
  }

  if (typeof window !== 'undefined') {
    window.__CORE_CASCADE__ = {
      controller,
      createGame,
      unbind,
      pollGamepad,
      gamepadTracker,
      getBgmState,
      fitLayout,
      toggleFullscreen,
      isFullscreenActive,
      updateFullscreenCapability,
      flushTrackQueue,
      stopLoop() {
        if (rafId !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      },
    };
  }

  return controller;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startApp(document));
  } else {
    startApp(document);
  }
}
