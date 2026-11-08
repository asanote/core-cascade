import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STICK_DEADZONE,
  REPEAT_DELAY_MS,
  REPEAT_INTERVAL_MS,
  readGamepadSnapshot,
  stepGamepad,
  createGamepadState,
  createGamepadTracker,
} from '../src/ui/gamepad.mjs';
import { keyToAction } from '../src/ui/input.mjs';
import {
  isHighStack,
  loadBgmPreference,
  saveBgmPreference,
  BGM_NORMAL_BPM,
  BGM_FAST_BPM,
  LOOP_STEPS,
  MELODY_STEPS,
  BASS_STEPS,
  HARMONY_STEPS,
  PERC_STEPS,
  scheduleBgmWindow,
  playActionSound,
  playEventSound,
  resetAudioForTest,
  unlockAudio,
  syncBgmWithGameState,
  toggleBgm,
  restartBgm,
  getBgmState,
} from '../src/ui/audio.mjs';
import { createBoard } from '../src/logic/board.mjs';
import { createGame } from '../src/logic/game.mjs';
import {
  track,
  flushTrackQueue,
  createGameController,
  isFullscreenSupported,
  startApp,
  queueEvents,
} from '../src/ui/main.mjs';
import { CONTROL_LABELS, CLEAR_STAGE_MS } from '../src/ui/renderer.mjs';

function makePad({ pressed = [], axes = [0, 0], mapping = 'standard', connected = true } = {}) {
  const buttons = Array.from({ length: 16 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  }));
  return {
    id: 'Standard Gamepad',
    index: 0,
    connected,
    mapping,
    buttons,
    axes,
  };
}

test('standard gamepad maps D-pad and face/center buttons by position', () => {
  assert.equal(STICK_DEADZONE, 0.5);
  assert.equal(REPEAT_DELAY_MS, 170);
  assert.equal(REPEAT_INTERVAL_MS, 50);

  // D-pad: 12 up (unused), 13 down, 14 left, 15 right
  assert.deepEqual(createGamepadTracker().poll(makePad({ pressed: [12] }), 0), []);
  assert.deepEqual(createGamepadTracker().poll(makePad({ pressed: [13] }), 0), ['down']);
  assert.deepEqual(createGamepadTracker().poll(makePad({ pressed: [14] }), 0), ['left']);
  assert.deepEqual(createGamepadTracker().poll(makePad({ pressed: [15] }), 0), ['right']);

  // Face & center buttons: 0=rotL, 1=rotR, 2=bgm, 8=restart, 9=pause
  assert.deepEqual(createGamepadTracker().poll(makePad({ pressed: [0] }), 0), ['rotL']);
  assert.deepEqual(createGamepadTracker().poll(makePad({ pressed: [1] }), 0), ['rotR']);
  assert.deepEqual(createGamepadTracker().poll(makePad({ pressed: [2] }), 0), ['bgm']);
  assert.deepEqual(createGamepadTracker().poll(makePad({ pressed: [8] }), 0), ['restart']);
  assert.deepEqual(createGamepadTracker().poll(makePad({ pressed: [9] }), 0), ['pause']);
});

test('left analog stick uses 0.5 deadzone for left, right, and down while ignoring up', () => {
  assert.deepEqual(createGamepadTracker().poll(makePad({ axes: [-0.49, 0.49] }), 0), []);
  assert.deepEqual(createGamepadTracker().poll(makePad({ axes: [0.49, -0.95] }), 0), []);
  assert.deepEqual(createGamepadTracker().poll(makePad({ axes: [-0.5, 0] }), 0), ['left']);
  assert.deepEqual(createGamepadTracker().poll(makePad({ axes: [0.5, 0] }), 0), ['right']);
  assert.deepEqual(createGamepadTracker().poll(makePad({ axes: [0, 0.5] }), 0), ['down']);
  assert.deepEqual(createGamepadTracker().poll(makePad({ axes: [-0.85, 0.75] }), 0), ['left', 'down']);
});

test('held left, right, and down auto-repeat after 170ms initial delay and every 50ms thereafter', () => {
  const tracker = createGamepadTracker();
  const holdLeft = makePad({ pressed: [14] });
  const idle = makePad();

  assert.deepEqual(tracker.poll(holdLeft, 1000), ['left']);
  assert.deepEqual(tracker.poll(holdLeft, 1050), []);
  assert.deepEqual(tracker.poll(holdLeft, 1169), []);
  assert.deepEqual(tracker.poll(holdLeft, 1170), ['left']);
  assert.deepEqual(tracker.poll(holdLeft, 1219), []);
  assert.deepEqual(tracker.poll(holdLeft, 1220), ['left']);
  assert.deepEqual(tracker.poll(holdLeft, 1270), ['left']);

  // Releasing and pressing again triggers immediately without waiting
  assert.deepEqual(tracker.poll(idle, 1280), []);
  assert.deepEqual(tracker.poll(holdLeft, 1290), ['left']);
});

test('action buttons (rotL, rotR, pause, restart, bgm) are strictly edge-triggered and never auto-repeat', () => {
  const tracker = createGamepadTracker();
  const holdButtons = makePad({ pressed: [0, 1, 2, 8, 9] });
  const releaseSome = makePad({ pressed: [1, 2, 8, 9] });

  assert.deepEqual(tracker.poll(holdButtons, 0), ['rotL', 'rotR', 'pause', 'restart', 'bgm']);
  assert.deepEqual(tracker.poll(holdButtons, 50), []);
  assert.deepEqual(tracker.poll(holdButtons, 170), []);
  assert.deepEqual(tracker.poll(holdButtons, 250), []);

  // Release button 0 only, then press it again
  assert.deepEqual(tracker.poll(releaseSome, 300), []);
  assert.deepEqual(tracker.poll(holdButtons, 320), ['rotL']);
});

test('ignores disconnected or non-standard gamepads and detects standard pads in sparse arrays', () => {
  const tracker = createGamepadTracker();
  const nonStandard = makePad({ pressed: [0, 14], mapping: 'nonstandard' });
  const disconnected = makePad({ pressed: [0, 14], connected: false });

  assert.deepEqual(tracker.poll([null, nonStandard, disconnected, null], 0), []);
  assert.equal(tracker.isConnected(), false);

  const standard = makePad({ pressed: [1] });
  assert.deepEqual(tracker.poll([null, standard, null, null], 10), ['rotR']);
  assert.equal(tracker.isConnected(), true);
});

test('stepGamepad is pure and does not mutate the previous state', () => {
  const s0 = createGamepadState();
  const snapshot = structuredClone(s0);
  const r1 = stepGamepad(s0, makePad({ pressed: [15, 0] }), 100);
  assert.deepEqual(s0, snapshot);
  assert.deepEqual(r1.actions, ['right', 'rotL']);
  assert.equal(r1.connected, true);
  assert.equal(readGamepadSnapshot(null).connected, false);
});

test('keyboard input maps M to bgm and F to fullscreen without repeating when held', () => {
  assert.equal(keyToAction({ key: 'm', repeat: false }), 'bgm');
  assert.equal(keyToAction({ key: 'M', repeat: false }), 'bgm');
  assert.equal(keyToAction({ key: 'm', repeat: true }), null);
  assert.equal(keyToAction({ key: 'f', repeat: false }), 'fullscreen');
  assert.equal(keyToAction({ key: 'F', repeat: false }), 'fullscreen');
  assert.equal(keyToAction({ key: 'f', repeat: true }), null);
});

test('BGM high-stack detector, pause/gameover stop, restart reset, and localStorage persistence work', () => {
  const board = createBoard();
  assert.equal(isHighStack(board), false);
  board[5][2] = 1;
  assert.equal(isHighStack(board), false);
  board[4][2] = 2;
  assert.equal(isHighStack(board), true);

  const fakeStorage = {
    data: new Map(),
    getItem(k) { return this.data.get(k) ?? null; },
    setItem(k, v) { this.data.set(k, v); },
  };
  saveBgmPreference(false, fakeStorage);
  assert.equal(loadBgmPreference(fakeStorage), false);
  saveBgmPreference(true, fakeStorage);
  assert.equal(loadBgmPreference(fakeStorage), true);

  resetAudioForTest({ unlocked: false, enabled: true });
  const game = createGame(1);
  syncBgmWithGameState(game);
  assert.equal(getBgmState().playing, false);

  unlockAudio();
  syncBgmWithGameState(game);
  assert.equal(getBgmState().playing, true);
  assert.equal(getBgmState().bpm, BGM_NORMAL_BPM);

  // High stack raises tempo, dropping stack restores normal tempo
  game.board[4][0] = 1;
  syncBgmWithGameState(game);
  assert.equal(getBgmState().bpm, BGM_FAST_BPM);
  game.board[4][0] = 0;
  syncBgmWithGameState(game);
  assert.equal(getBgmState().bpm, BGM_NORMAL_BPM);

  // Pause and gameover stop BGM
  syncBgmWithGameState({ ...game, paused: true });
  assert.equal(getBgmState().playing, false);
  syncBgmWithGameState(game);
  assert.equal(getBgmState().playing, true);
  syncBgmWithGameState({ ...game, over: true });
  assert.equal(getBgmState().playing, false);

  // Toggle M / bgm off and on
  toggleBgm({ paused: false, over: false });
  assert.equal(getBgmState().enabled, false);
  assert.equal(getBgmState().playing, false);
  toggleBgm({ paused: false, over: false });
  assert.equal(getBgmState().enabled, true);
  assert.equal(getBgmState().playing, true);

  restartBgm();
  assert.equal(getBgmState().currentStep, 0);
  resetAudioForTest();
});

test('GoatCounter track helper never throws offline and records start, chain2 once, and gameover', () => {
  // Never throws when window is undefined
  assert.doesNotThrow(() => track('start', 'Start'));

  const recorded = [];
  globalThis.window = {
    goatcounter: {
      count(payload) {
        recorded.push(payload);
      },
    },
  };
  try {
    const controller = createGameController({ seed: 1 });
    assert.deepEqual(recorded.map(r => r.path), ['cascade-start']);

    // Simulate 2-chain event: tracked only once per game
    controller.trackEvents([{ type: 'clear', step: { chain: 2 } }], controller.state);
    controller.trackEvents([{ type: 'clear', step: { chain: 3 } }], controller.state);
    assert.deepEqual(recorded.map(r => r.path), ['cascade-start', 'cascade-chain2']);

    // Simulate game over
    controller.trackEvents([{ type: 'gameover' }], { ...controller.state, over: true });
    assert.deepEqual(recorded.map(r => r.path), ['cascade-start', 'cascade-chain2', 'cascade-gameover']);

    // Restart fires cascade-start and resets per-game chain2 flag
    controller.dispatch('restart');
    controller.trackEvents([{ type: 'clear', step: { chain: 2 } }], controller.state);
    assert.deepEqual(recorded.map(r => r.path), [
      'cascade-start',
      'cascade-chain2',
      'cascade-gameover',
      'cascade-start',
      'cascade-chain2',
    ]);
  } finally {
    delete globalThis.window;
    resetAudioForTest();
  }
});

test('F1: GoatCounter event queue buffers early events and flushes once when tracker appears', () => {
  const recorded = [];
  globalThis.window = {};
  try {
    // Controller created before GoatCounter script has loaded
    const controller = createGameController({ seed: 7 });
    // Early events and deduplication before tracker loads
    controller.trackEvents([{ type: 'clear', step: { chain: 2 } }], controller.state);
    controller.trackEvents([{ type: 'clear', step: { chain: 3 } }], controller.state);
    assert.deepEqual(recorded, []);

    // Tracker loads late
    globalThis.window.goatcounter = {
      count(payload) {
        recorded.push(payload);
      },
    };

    // Stepping or flushing drains the queue once in order
    controller.step(16);
    assert.deepEqual(recorded.map(r => r.path), ['cascade-start', 'cascade-chain2']);

    // Subsequent steps or flush calls do not re-send already flushed events
    controller.step(16);
    flushTrackQueue();
    assert.deepEqual(recorded.map(r => r.path), ['cascade-start', 'cascade-chain2']);
  } finally {
    delete globalThis.window;
    resetAudioForTest();
  }
});

test('F2: isFullscreenSupported honors disabled flags and fullscreen state rolls back on rejection', async () => {
  // Capability detection checks
  assert.equal(isFullscreenSupported(null), false);
  assert.equal(
    isFullscreenSupported({
      documentElement: { requestFullscreen() {} },
      fullscreenEnabled: false,
    }),
    false
  );
  assert.equal(
    isFullscreenSupported({
      documentElement: { webkitRequestFullscreen() {} },
      webkitFullscreenEnabled: false,
    }),
    false
  );
  assert.equal(
    isFullscreenSupported({
      documentElement: { requestFullscreen() {} },
      fullscreenEnabled: true,
    }),
    true
  );

  // Fullscreen rejection rollback check
  let requestCount = 0;
  let shouldReject = true;
  const classSet = new Set();
  const fsBtnAttrs = new Map();
  const fsBtn = {
    hidden: false,
    textContent: '全画面 (F)',
    setAttribute(k, v) { fsBtnAttrs.set(k, v); },
    getAttribute(k) { return fsBtnAttrs.get(k); },
    addEventListener() {},
    blur() {},
  };
  const canvas = {
    width: 560,
    height: 640,
    style: { width: '560px', height: '640px' },
    getContext() { return null; },
  };
  const fakeDoc = {
    fullscreenElement: null,
    webkitFullscreenElement: null,
    fullscreenEnabled: true,
    body: {
      classList: {
        toggle(cls, force) {
          if (force) classSet.add(cls);
          else classSet.delete(cls);
        },
        contains(cls) {
          return classSet.has(cls);
        },
      },
    },
    documentElement: {
      requestFullscreen() {
        requestCount++;
        if (shouldReject) {
          return Promise.reject(new TypeError('Fullscreen denied'));
        }
        fakeDoc.fullscreenElement = fakeDoc.documentElement;
        return Promise.resolve();
      },
    },
    getElementById(id) {
      if (id === 'game-canvas') return canvas;
      if (id === 'fullscreen-btn') return fsBtn;
      return null;
    },
    querySelector() { return null; },
    addEventListener() {},
  };

  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener() {},
  };
  try {
    const controller = startApp(fakeDoc);
    const app = globalThis.window.__CORE_CASCADE__;
    assert.equal(app.isFullscreenActive(), false);

    // Press F -> requestFullscreen rejects -> state rolls back
    controller.dispatch('fullscreen');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(requestCount, 1);
    assert.equal(app.isFullscreenActive(), false);
    assert.equal(fakeDoc.body.classList.contains('is-fullscreen'), false);
    assert.equal(fsBtn.textContent, '全画面 (F)');
    assert.equal(fsBtn.getAttribute('aria-pressed'), 'false');

    // Pressing F again retries entry instead of exiting fictional state
    shouldReject = false;
    controller.dispatch('fullscreen');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(requestCount, 2);
    assert.equal(app.isFullscreenActive(), true);
    assert.equal(fakeDoc.body.classList.contains('is-fullscreen'), true);
    assert.equal(fsBtn.textContent, '全画面解除 (F)');
    assert.equal(fsBtn.getAttribute('aria-pressed'), 'true');
  } finally {
    delete globalThis.window;
    resetAudioForTest();
  }
});

test('F3: control labels explicitly identify Switch and Xbox buttons and screen fullscreen button', () => {
  const byAction = Object.fromEntries(CONTROL_LABELS);
  assert.match(byAction['Rotate L'], /Switch B.*Xbox A.*bottom/);
  assert.match(byAction['Rotate R'], /Switch A.*Xbox B.*right/);
  assert.match(byAction['BGM'], /Switch Y.*Xbox X.*left/);
  assert.match(byAction['Pause'], /Switch \+.*Xbox Menu/);
  assert.match(byAction['Restart'], /Switch -.*Xbox View/);
  assert.equal(byAction['Fullscreen'], 'F / 画面のボタン');
});

test('F4: throwing localStorage getter does not break module import or BGM preference helpers', async () => {
  const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError: Storage access denied');
    },
  });
  try {
    assert.doesNotThrow(() => loadBgmPreference());
    assert.equal(loadBgmPreference(), true);
    assert.doesNotThrow(() => saveBgmPreference(false));

    // Re-importing the module with a throwing localStorage getter must succeed
    const mod = await import(`../src/ui/audio.mjs?storageThrow=${Date.now()}`);
    assert.equal(mod.isBgmEnabled(), true);
    assert.equal(mod.toggleBgm(), false);
    assert.equal(mod.isBgmEnabled(), false);
  } finally {
    if (prevDesc) {
      Object.defineProperty(globalThis, 'localStorage', prevDesc);
    } else {
      delete globalThis.localStorage;
    }
    resetAudioForTest();
  }
});

test('F5: MELODY_STEPS, BASS_STEPS, HARMONY_STEPS, and PERC_STEPS each have 4 bars of 16 steps (64 total)', () => {
  assert.equal(LOOP_STEPS, 64);
  assert.equal(MELODY_STEPS.length, 64);
  assert.equal(BASS_STEPS.length, 64);
  assert.equal(HARMONY_STEPS.length, 64);
  assert.equal(PERC_STEPS.length, 64);

  for (let bar = 0; bar < 4; bar++) {
    const barSlice = MELODY_STEPS.slice(bar * 16, (bar + 1) * 16);
    assert.equal(barSlice.length, 16);
    assert.ok(barSlice.some(step => Array.isArray(step)), `Bar ${bar + 1} has melody notes`);
  }

  // Verify scheduler advances currentStep and restartBgm resets a non-zero currentStep
  let currentTime = 0;
  globalThis.window = {
    AudioContext: class {
      constructor() {
        this.state = 'running';
        this.sampleRate = 44100;
        this.destination = {};
      }
      get currentTime() { return currentTime; }
      resume() { this.state = 'running'; return Promise.resolve(); }
      createGain() {
        return {
          gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          disconnect() {},
        };
      }
      createOscillator() {
        return {
          type: 'square',
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          start() {},
          stop() {},
        };
      }
      createBuffer() {
        return { getChannelData() { return new Float32Array(3528); } };
      }
      createBufferSource() {
        return { buffer: null, connect() {}, start() {}, stop() {} };
      }
    },
  };
  try {
    resetAudioForTest({ unlocked: true, enabled: true });
    syncBgmWithGameState(createGame(1));
    for (let i = 0; i < 6; i++) {
      currentTime += 0.1;
      scheduleBgmWindow();
    }
    const advancedStep = getBgmState().currentStep;
    assert.ok(advancedStep >= 5, `currentStep advanced past multiple steps (got ${advancedStep})`);
    restartBgm();
    // restartBgm resets currentStep to 0 and immediately schedules step 0 in the lookahead window (leaving next step = 1)
    assert.equal(getBgmState().currentStep, 1, 'restartBgm resets loop back to bar 1 start');
  } finally {
    delete globalThis.window;
    resetAudioForTest();
  }
});

test('F6: sound effects do not create AudioContext before unlock and unlockAudio retries resume until running', () => {
  let ctxConstructed = 0;
  let resumeCalls = 0;
  let oscCreated = 0;
  let allowResume = false;

  globalThis.window = {
    AudioContext: class {
      constructor() {
        ctxConstructed++;
        this.state = 'suspended';
        this.currentTime = 0;
        this.destination = {};
      }
      resume() {
        resumeCalls++;
        if (allowResume) {
          this.state = 'running';
        }
        return Promise.resolve();
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          disconnect() {},
        };
      }
      createOscillator() {
        oscCreated++;
        return {
          type: 'sine',
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          start() {},
          stop() {},
        };
      }
    },
  };

  try {
    resetAudioForTest({ unlocked: false, enabled: true });
    // Pre-gesture SFX must not instantiate AudioContext or queue oscillators
    playActionSound('left');
    playEventSound({ type: 'lock' });
    assert.equal(ctxConstructed, 0);
    assert.equal(oscCreated, 0);

    // First gesture (e.g. pointerdown) where browser keeps AudioContext suspended
    unlockAudio();
    assert.equal(ctxConstructed, 1);
    assert.equal(resumeCalls, 1);
    playActionSound('left');
    assert.equal(oscCreated, 0, 'No oscillator queued while AudioContext remains suspended');

    // Second gesture (e.g. click/keydown) retries resume() and transitions to running
    allowResume = true;
    unlockAudio();
    assert.equal(resumeCalls, 2);
    playActionSound('left');
    assert.equal(oscCreated, 1, 'Oscillator plays once AudioContext is running');
  } finally {
    delete globalThis.window;
    resetAudioForTest();
  }
});

test('F7: BGM gameover stop and high-stack tempo follow the clear animation view rather than post-chain state', () => {
  resetAudioForTest({ unlocked: true, enabled: true });
  try {
    const controller = createGameController({ seed: 1 });
    assert.equal(getBgmState().playing, true);
    assert.equal(getBgmState().bpm, BGM_NORMAL_BPM);

    // Simulate a clear animation where pre-clear board has a high stack (row 4) and post-chain state is game over
    const preBoard = createBoard();
    preBoard[4][2] = 1;
    preBoard[12][0] = 1;
    preBoard[12][1] = 1;
    preBoard[12][2] = 1;
    preBoard[12][3] = 1;
    const prevState = { ...controller.state, board: preBoard, over: false };
    const nextState = { ...controller.state, board: createBoard(), over: true };
    const clearEvents = [
      {
        type: 'clear',
        step: {
          chain: 1,
          cleared: 4,
          score: 40,
          groups: [[{ x: 0, y: 12 }, { x: 1, y: 12 }, { x: 2, y: 12 }, { x: 3, y: 12 }]],
        },
      },
      { type: 'gameover' },
    ];

    controller.state = nextState;
    queueEvents(controller.anim, prevState, nextState, clearEvents);

    // Step 100ms into the 380ms clear animation: still in flash stage, BGM must still play at high-stack tempo
    controller.step(100);
    assert.equal(controller.getView().over, false);
    assert.equal(getBgmState().playing, true);
    assert.equal(getBgmState().bpm, BGM_FAST_BPM);

    // Advance past the remainder of the clear animation: view.over becomes true and BGM stops
    controller.step(CLEAR_STAGE_MS);
    assert.equal(controller.getView().over, true);
    assert.equal(getBgmState().playing, false);
  } finally {
    resetAudioForTest();
  }
});
