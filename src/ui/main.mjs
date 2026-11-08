import { createGame, applyAction, tick, dropInterval } from '../logic/game.mjs';
import {
  drawGame,
  buildClearStages,
  getRenderView,
  CHAIN_POPUP_MS,
} from './renderer.mjs';
import { bindKeys } from './input.mjs';
import { playActionSound, playEventSound } from './audio.mjs';

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

export function createGameController({ ctx = null, seed = Date.now(), statusEl = null } = {}) {
  const controller = {
    ctx,
    statusEl,
    seed,
    state: createGame(seed),
    anim: createAnimState(),
    render() {
      if (this.ctx) {
        drawGame(this.ctx, this.state, this.anim);
      }
      if (this.statusEl) {
        const view = getRenderView(this.state, this.anim);
        if (view.over) {
          this.statusEl.textContent = 'GAME OVER — Press R to Restart';
        } else if (view.paused) {
          this.statusEl.textContent = 'PAUSED — Press P to Resume';
        } else if (view.chainPopup && view.chainPopup.chain >= 1) {
          this.statusEl.textContent = `${view.chainPopup.chain} CHAIN! SCORE ${view.score}`;
        } else {
          this.statusEl.textContent = `SCORE ${view.score} | MAX CHAIN ${view.maxChain} | SPEED ${dropInterval({ score: view.score })}ms`;
        }
      }
    },
    dispatch(action) {
      if (action === 'restart') {
        this.state = createGame(Date.now());
        this.anim = createAnimState();
        playActionSound('restart');
        this.render();
        return this.state;
      }
      if (action === 'pause') {
        const result = applyAction(this.state, 'pause');
        this.state = result.state;
        playActionSound('pause');
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
      }
      this.render();
      return this.state;
    },
    step(dtMs) {
      if (!Number.isFinite(dtMs) || dtMs <= 0) return this.state;
      // Stop advancing game time while a clear animation is active or once one is queued
      if (isAnimatingClear(this.anim)) {
        stepAnim(this.anim, dtMs, this.state.paused);
        this.render();
        return this.state;
      }
      stepAnim(this.anim, dtMs, this.state.paused);
      const prevState = this.state;
      const result = tick(prevState, dtMs);
      this.state = result.state;
      if (result.events.length > 0) {
        queueEvents(this.anim, prevState, result.state, result.events);
      }
      this.render();
      return this.state;
    },
    getView() {
      return getRenderView(this.state, this.anim);
    },
  };

  controller.render();
  return controller;
}

export function startApp(rootDoc = typeof document !== 'undefined' ? document : null) {
  if (!rootDoc) return null;
  const canvas = rootDoc.getElementById('game-canvas');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const statusEl = rootDoc.getElementById('game-status');

  let initialSeed = Date.now();
  if (typeof window !== 'undefined' && window.location?.search) {
    const params = new URLSearchParams(window.location.search);
    const parsed = Number(params.get('seed'));
    if (Number.isFinite(parsed) && params.has('seed')) {
      initialSeed = parsed;
    }
  }

  const controller = createGameController({ ctx, seed: initialSeed, statusEl });
  const target = typeof window !== 'undefined' ? window : rootDoc;
  const unbind = bindKeys(target, action => controller.dispatch(action));

  let lastTime = null;
  let rafId = null;

  function frame(now) {
    if (lastTime === null) {
      lastTime = now;
    }
    const dtMs = Math.min(100, Math.max(0, now - lastTime));
    lastTime = now;
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
