const KEY_MAP = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'down',
  z: 'rotL',
  Z: 'rotL',
  KeyZ: 'rotL',
  x: 'rotR',
  X: 'rotR',
  KeyX: 'rotR',
  p: 'pause',
  P: 'pause',
  KeyP: 'pause',
  r: 'restart',
  R: 'restart',
  KeyR: 'restart',
};

const NON_REPEAT_ACTIONS = new Set(['rotL', 'rotR', 'pause', 'restart']);

export function keyToAction(event) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey) return null;
  const action = KEY_MAP[event.key] ?? KEY_MAP[event.code] ?? null;
  if (!action) return null;
  if (event.repeat && NON_REPEAT_ACTIONS.has(action)) return null;
  return action;
}

export function bindKeys(target, onAction) {
  if (!target || typeof target.addEventListener !== 'function') {
    return () => {};
  }
  const handler = event => {
    const action = keyToAction(event);
    if (!action) return;
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    onAction(action, event);
  };
  target.addEventListener('keydown', handler);
  return () => {
    if (typeof target.removeEventListener === 'function') {
      target.removeEventListener('keydown', handler);
    }
  };
}
