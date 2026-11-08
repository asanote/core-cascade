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
  resetAudioForTest,
  unlockAudio,
  syncBgmWithGameState,
  toggleBgm,
  restartBgm,
  getBgmState,
} from '../src/ui/audio.mjs';
import { createBoard } from '../src/logic/board.mjs';
import { createGame } from '../src/logic/game.mjs';
import { track, createGameController } from '../src/ui/main.mjs';

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
