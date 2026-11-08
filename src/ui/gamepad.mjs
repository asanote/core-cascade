// Pure Gamepad API standard-mapping input & auto-repeat module

export const STICK_DEADZONE = 0.5;
export const REPEAT_DELAY_MS = 170;
export const REPEAT_INTERVAL_MS = 50;

export const REPEATABLE_ACTIONS = ['left', 'right', 'down'];
export const EDGE_ACTIONS = ['rotL', 'rotR', 'pause', 'restart', 'bgm'];

export function isButtonPressed(button) {
  if (!button) return false;
  if (typeof button === 'boolean') return button;
  if (typeof button === 'number') return button > 0.5;
  return Boolean(button.pressed || (typeof button.value === 'number' && button.value > 0.5));
}

export function isStandardGamepad(pad) {
  if (!pad || typeof pad !== 'object') return false;
  if (pad.connected === false) return false;
  if (pad.mapping !== undefined && pad.mapping !== 'standard') return false;
  return true;
}

export function readGamepadSnapshot(pad, deadzone = STICK_DEADZONE) {
  const empty = {
    connected: false,
    left: false,
    right: false,
    down: false,
    rotL: false,
    rotR: false,
    bgm: false,
    restart: false,
    pause: false,
  };
  if (!isStandardGamepad(pad)) return empty;

  const buttons = Array.isArray(pad.buttons) || ArrayBuffer.isView(pad.buttons) ? pad.buttons : (pad.buttons ?? []);
  const axes = Array.isArray(pad.axes) || ArrayBuffer.isView(pad.axes) ? pad.axes : (pad.axes ?? []);

  const axisX = typeof axes[0] === 'number' && Number.isFinite(axes[0]) ? axes[0] : 0;
  const axisY = typeof axes[1] === 'number' && Number.isFinite(axes[1]) ? axes[1] : 0;

  // D-pad: 12 up (unused), 13 down, 14 left, 15 right
  // Left stick: axes[0] horizontal, axes[1] vertical (deadzone 0.5)
  const rawLeft = isButtonPressed(buttons[14]) || axisX <= -deadzone;
  const rawRight = isButtonPressed(buttons[15]) || axisX >= deadzone;
  const down = isButtonPressed(buttons[13]) || axisY >= deadzone;

  // Face & center buttons by position (standard mapping):
  // buttons[0] (bottom face: Switch B / Xbox A) = rotate left
  // buttons[1] (right face: Switch A / Xbox B) = rotate right
  // buttons[2] (left face: Switch Y / Xbox X) = BGM toggle
  // buttons[8] (Switch - / Xbox View) = restart
  // buttons[9] (Switch + / Xbox Menu) = pause
  return {
    connected: true,
    left: rawLeft && !rawRight,
    right: rawRight && !rawLeft,
    down,
    rotL: isButtonPressed(buttons[0]),
    rotR: isButtonPressed(buttons[1]),
    bgm: isButtonPressed(buttons[2]),
    restart: isButtonPressed(buttons[8]),
    pause: isButtonPressed(buttons[9]),
  };
}

export function mergeGamepadSnapshots(padOrPads, deadzone = STICK_DEADZONE) {
  const merged = {
    connected: false,
    left: false,
    right: false,
    down: false,
    rotL: false,
    rotR: false,
    bgm: false,
    restart: false,
    pause: false,
  };
  if (!padOrPads) return merged;

  const list = Array.isArray(padOrPads) || (typeof padOrPads.length === 'number' && !('buttons' in padOrPads) && !('axes' in padOrPads))
    ? Array.from(padOrPads)
    : [padOrPads];

  let rawLeft = false;
  let rawRight = false;

  for (const pad of list) {
    const snap = readGamepadSnapshot(pad, deadzone);
    if (!snap.connected) continue;
    merged.connected = true;
    rawLeft = rawLeft || snap.left;
    rawRight = rawRight || snap.right;
    merged.down = merged.down || snap.down;
    merged.rotL = merged.rotL || snap.rotL;
    merged.rotR = merged.rotR || snap.rotR;
    merged.bgm = merged.bgm || snap.bgm;
    merged.restart = merged.restart || snap.restart;
    merged.pause = merged.pause || snap.pause;
  }

  merged.left = rawLeft && !rawRight;
  merged.right = rawRight && !rawLeft;
  return merged;
}

export function createGamepadState() {
  return {
    connected: false,
    held: {
      left: null,
      right: null,
      down: null,
    },
    pressed: {
      rotL: false,
      rotR: false,
      pause: false,
      restart: false,
      bgm: false,
    },
  };
}

export function stepGamepad(
  prevState = createGamepadState(),
  padOrPads = null,
  nowMs = 0,
  options = {}
) {
  const repeatDelayMs = options.repeatDelayMs ?? REPEAT_DELAY_MS;
  const repeatIntervalMs = options.repeatIntervalMs ?? REPEAT_INTERVAL_MS;
  const deadzone = options.deadzone ?? STICK_DEADZONE;

  const snap = mergeGamepadSnapshots(padOrPads, deadzone);
  const actions = [];

  const nextHeld = {
    left: null,
    right: null,
    down: null,
  };

  for (const dir of REPEATABLE_ACTIONS) {
    if (snap[dir]) {
      const prev = prevState?.held?.[dir] ?? null;
      if (!prev) {
        actions.push(dir);
        nextHeld[dir] = {
          sinceMs: nowMs,
          nextRepeatMs: nowMs + repeatDelayMs,
        };
      } else if (nowMs >= prev.nextRepeatMs) {
        actions.push(dir);
        let nextRepeatMs = prev.nextRepeatMs + repeatIntervalMs;
        if (nowMs >= nextRepeatMs) {
          const stepsBehind = Math.floor((nowMs - prev.nextRepeatMs) / repeatIntervalMs);
          nextRepeatMs = prev.nextRepeatMs + (stepsBehind + 1) * repeatIntervalMs;
        }
        nextHeld[dir] = {
          sinceMs: prev.sinceMs,
          nextRepeatMs,
        };
      } else {
        nextHeld[dir] = { ...prev };
      }
    }
  }

  const nextPressed = {
    rotL: false,
    rotR: false,
    pause: false,
    restart: false,
    bgm: false,
  };

  for (const act of EDGE_ACTIONS) {
    const isDown = Boolean(snap[act]);
    const wasDown = Boolean(prevState?.pressed?.[act]);
    if (isDown && !wasDown) {
      actions.push(act);
    }
    nextPressed[act] = isDown;
  }

  return {
    state: {
      connected: snap.connected,
      held: nextHeld,
      pressed: nextPressed,
    },
    actions,
    connected: snap.connected,
  };
}

export function createGamepadTracker(options = {}) {
  let state = createGamepadState();
  return {
    poll(padOrPads, nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
      const result = stepGamepad(state, padOrPads, nowMs, options);
      state = result.state;
      return result.actions;
    },
    isConnected() {
      return state.connected;
    },
    getState() {
      return state;
    },
    reset() {
      state = createGamepadState();
    },
  };
}

export function pollNavigatorGamepads(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav || typeof nav.getGamepads !== 'function') return [];
  try {
    return nav.getGamepads() || [];
  } catch {
    return [];
  }
}
