import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../src/ui/main.mjs';
import { getBgmState, resetAudioForTest, scheduleBgmWindow } from '../src/ui/audio.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function startFullscreenApp(t, requestName, request) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const classes = new Set();
  const attrs = new Map();
  const button = Object.assign(new EventTarget(), {
    setAttribute(name, value) { attrs.set(name, value); },
    getAttribute(name) { return attrs.get(name); },
    blur() {},
  });
  const note = { hidden: true };
  const canvas = { style: {}, getContext() { return null; } };
  const elements = { 'game-canvas': canvas, 'fullscreen-btn': button, 'fullscreen-note': note };
  const doc = Object.assign(new EventTarget(), {
    fullscreenElement: null,
    webkitFullscreenElement: null,
    documentElement: requestName ? { [requestName]: request } : {},
    body: { classList: {
      toggle(name, active) { if (active) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); },
    } },
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
  });
  let audioTime = 0;
  globalThis.window = Object.assign(new EventTarget(), {
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    location: { search: '?seed=1' },
    AudioContext: class {
      state = 'running';
      destination = {};
      get currentTime() { return audioTime; }
      createGain() {
        return {
          gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {}, disconnect() {},
        };
      }
      createOscillator() {
        return {
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {}, start() {}, stop() {},
        };
      }
      createBuffer() { return { getChannelData() { return new Float32Array(3528); } }; }
      createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
    },
  });
  t.after(() => {
    resetAudioForTest();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });
  resetAudioForTest({ unlocked: true, enabled: true });
  const controller = startApp(doc);
  const app = window.__CORE_CASCADE__;
  t.after(() => app.unbind());
  controller.step(100);
  audioTime = 1;
  scheduleBgmWindow();
  const state = controller.state;
  const { rng, ...gameData } = state;
  const stateSnapshot = { ...structuredClone(gameData), rng };
  const bgm = getBgmState();
  assert.equal(bgm.playing, true);
  assert.ok(bgm.currentStep > 1, 'BGM has advanced so a reset is detectable');

  function assertMode(active) {
    assert.equal(app.isFullscreenActive(), active);
    assert.equal(doc.body.classList.contains('is-fullscreen'), active);
    assert.equal(button.textContent, active ? '全画面解除 (F)' : '全画面 (F)');
    assert.equal(button.getAttribute('aria-pressed'), String(active));
    if (active) {
      assert.ok(parseInt(canvas.style.width) > 560, 'confirmed fullscreen enlarges the canvas');
      assert.ok(parseInt(canvas.style.height) > 640);
    } else {
      assert.equal(canvas.style.width, '560px');
      assert.equal(canvas.style.height, '640px');
    }
    assert.equal(controller.state, state, 'fullscreen does not replace game state');
    assert.deepEqual(controller.state, stateSnapshot, 'fullscreen does not pause or reset the game');
    assert.deepEqual(getBgmState(), bgm, 'fullscreen does not pause or reset BGM');
  }
  return { doc, controller, app, button, note, assertMode };
}

for (const api of [
  { name: 'standard', request: 'requestFullscreen', element: 'fullscreenElement', change: 'fullscreenchange', error: 'fullscreenerror', exit: 'exitFullscreen' },
  { name: 'WebKit', request: 'webkitRequestFullscreen', element: 'webkitFullscreenElement', change: 'webkitfullscreenchange', error: 'webkitfullscreenerror', exit: 'webkitExitFullscreen' },
]) {
  test(`F2 ${api.name}: a pending request leaves fullscreen UI in normal mode`, async t => {
    const request = deferred();
    const { controller, app, assertMode } = startFullscreenApp(t, api.request, () => request.promise);
    controller.dispatch('fullscreen');
    assertMode(false);
    await Promise.resolve();
    app.fitLayout();
    controller.render();
    assertMode(false);
  });

  test(`F2 ${api.name}: native change events confirm entry and exit`, async t => {
    const request = deferred();
    const exit = deferred();
    const { doc, controller, assertMode } = startFullscreenApp(t, api.request, () => request.promise);
    doc[api.exit] = () => exit.promise;
    controller.dispatch('fullscreen');
    request.resolve();
    await request.promise;
    assertMode(false);

    doc[api.element] = doc.documentElement;
    doc.dispatchEvent(new Event(api.change));
    assertMode(true);
    controller.dispatch('fullscreen');
    assertMode(true);
    doc[api.element] = null;
    doc.dispatchEvent(new Event(api.change));
    assertMode(false);
    exit.resolve();
    await exit.promise;
    assertMode(false);
  });

  test(`F2 ${api.name}: a rejected request leaves fullscreen UI inactive and allows retry`, async t => {
    const request = deferred();
    const { doc, controller, assertMode } = startFullscreenApp(t, api.request, () => request.promise);
    controller.dispatch('fullscreen');
    assertMode(false);
    request.reject(new TypeError('Fullscreen denied'));
    await request.promise.catch(() => {});
    assertMode(false);

    doc.documentElement[api.request] = () => {
      doc[api.element] = doc.documentElement;
      doc.dispatchEvent(new Event(api.change));
    };
    controller.dispatch('fullscreen');
    assertMode(true);
  });

  test(`F2 ${api.name}: throws and error events refresh from native state`, t => {
    const { doc, controller, assertMode } = startFullscreenApp(t, api.request, () => {
      throw new TypeError('Fullscreen denied');
    });
    controller.dispatch('fullscreen');
    assertMode(false);
    doc[api.element] = doc.documentElement;
    doc.dispatchEvent(new Event(api.error));
    assertMode(true);
    doc[api.element] = null;
    doc.dispatchEvent(new Event(api.error));
    assertMode(false);
  });

  test(`F2 ${api.name}: exit rejection refreshes native state`, async t => {
    const exit = deferred();
    const { doc, controller, assertMode } = startFullscreenApp(t, api.request, () => {});
    doc[api.element] = doc.documentElement;
    doc.dispatchEvent(new Event(api.change));
    doc[api.exit] = () => exit.promise;
    controller.dispatch('exitFullscreen');
    assertMode(true);
    doc[api.element] = null;
    exit.reject(new TypeError('Exit failed'));
    await exit.promise.catch(() => {});
    assertMode(false);
  });
}

test('F2: unavailable fullscreen API keeps the iPhone button hidden and note visible', t => {
  const { controller, button, note, assertMode } = startFullscreenApp(t);
  assert.equal(button.hidden, true);
  assert.equal(note.hidden, false);
  controller.dispatch('fullscreen');
  assertMode(false);
});
