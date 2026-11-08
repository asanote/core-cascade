// Synthesized Web Audio sound effects and original lookahead-scheduled BGM (no external audio assets)

export const BGM_STORAGE_KEY = 'core-cascade-bgm';
export const BGM_NORMAL_BPM = 136;
export const BGM_FAST_BPM = 162;
export const HIGH_STACK_ROW = 4;

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.12;
export const LOOP_STEPS = 64; // 4 bars of 16th notes

let audioCtx = null;
let noiseBuffer = null;
let bgmBus = null;

let audioUnlocked = false;
let bgmEnabled = loadBgmPreference();
let bgmPlaying = false;
let bgmHighTempo = false;
let currentStep = 0;
let nextNoteTime = 0;
let schedulerTimer = null;

// Original 4-bar bright bouncy puzzle loop ("Cascade Pulse" in F major / D minor pentatonic)
// Each entry is [midiNote, lengthIn16ths] or null for rest. Each bar is 16 sixteenth-note steps (64 total).
export const MELODY_STEPS = [
  // Bar 1 (16 steps): Sunny rising cascade motif (F -> Dm)
  [77, 2], null, [81, 1], [84, 2], null, [79, 1], [81, 2], null,
  [77, 1], [74, 1], [72, 2], null, [74, 1], [77, 2], null, [81, 1],
  // Bar 2 (16 steps): Bouncy answer phrase (Gm -> C)
  [79, 2], null, [82, 1], [86, 2], null, [84, 1], [81, 2], null,
  [79, 1], [77, 1], [76, 2], null, [79, 2], null, [84, 2], null,
  // Bar 3 (16 steps): High sparkle jump (F -> Bb)
  [81, 2], null, [84, 1], [89, 2], null, [88, 1], [86, 2], null,
  [84, 1], [81, 1], [82, 2], null, [81, 1], [77, 1], [74, 2], null,
  // Bar 4 (16 steps): Playful turnaround back to root (Gm -> C7)
  [79, 1], [81, 1], [82, 2], null, [86, 1], [84, 2], null, [81, 1],
  [79, 2], null, [76, 2], null, [77, 2], null, [84, 2], null,
];

// Bouncy off-beat triangle bassline (MIDI note numbers)
export const BASS_STEPS = [
  // Bar 1 (F -> Dm)
  53, null, 65, null, 53, null, 60, 53,
  50, null, 62, null, 50, null, 57, 50,
  // Bar 2 (Gm -> C)
  55, null, 67, null, 55, null, 62, 55,
  48, null, 60, null, 52, null, 55, 60,
  // Bar 3 (F -> Bb)
  53, null, 65, null, 57, null, 60, 65,
  58, null, 70, null, 58, null, 62, 65,
  // Bar 4 (Gm -> C7)
  55, null, 67, null, 57, null, 69, null,
  60, null, 67, null, 55, 57, 58, 60,
];

// Light off-beat harmony / arpeggio chimes
export const HARMONY_STEPS = [
  null, null, 69, null, null, null, 72, null, null, null, 69, null, null, null, 65, null,
  null, null, 70, null, null, null, 74, null, null, null, 72, null, null, null, 67, null,
  null, null, 72, null, null, null, 77, null, null, null, 74, null, null, null, 70, null,
  null, null, 70, null, null, null, 72, null, null, null, 76, null, 72, null, null, null,
];

// Light percussion pattern: 'k' = soft kick, 'h' = crisp hi-hat, 's' = light snare/pop
export const PERC_STEPS = [
  'k', null, 'h', null, 's', null, 'h', 'k', null, 'h', 'k', null, 's', null, 'h', null,
  'k', null, 'h', null, 's', null, 'h', 'k', null, 'h', 'k', null, 's', null, 'h', 'h',
  'k', null, 'h', null, 's', null, 'h', 'k', null, 'h', 'k', null, 's', null, 'h', null,
  'k', null, 'h', null, 's', null, 'h', 'k', null, 'h', 'k', 'h', 's', null, 'h', 's',
];

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function loadBgmPreference(storage) {
  try {
    const targetStorage =
      storage !== undefined
        ? storage
        : typeof localStorage !== 'undefined'
          ? localStorage
          : null;
    if (!targetStorage || typeof targetStorage.getItem !== 'function') return true;
    const raw = targetStorage.getItem(BGM_STORAGE_KEY);
    if (raw === 'off' || raw === '0' || raw === 'false') return false;
    if (raw === 'on' || raw === '1' || raw === 'true') return true;
  } catch {
    // Ignore storage access errors (including SecurityError on localStorage getter)
  }
  return true;
}

export function saveBgmPreference(enabled, storage) {
  try {
    const targetStorage =
      storage !== undefined
        ? storage
        : typeof localStorage !== 'undefined'
          ? localStorage
          : null;
    if (!targetStorage || typeof targetStorage.setItem !== 'function') return;
    targetStorage.setItem(BGM_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Ignore storage access errors (including SecurityError on localStorage getter)
  }
}

export function isHighStack(board, thresholdRow = HIGH_STACK_ROW) {
  if (!Array.isArray(board)) return false;
  const maxRow = Math.min(thresholdRow, board.length - 1);
  for (let y = 0; y <= maxRow; y++) {
    const row = board[y];
    if (!Array.isArray(row)) continue;
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== 0) return true;
    }
  }
  return false;
}

function getAudioContext() {
  if (!audioUnlocked) return null;
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function getBgmBus(ctx) {
  if (!ctx) return null;
  if (!bgmBus) {
    try {
      bgmBus = ctx.createGain();
      // Keep overall BGM noticeably lower than sound effects
      bgmBus.gain.setValueAtTime(0.55, ctx.currentTime);
      bgmBus.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  return bgmBus;
}

function resetBgmBus(ctx) {
  if (bgmBus) {
    try {
      bgmBus.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    bgmBus = null;
  }
  if (ctx) {
    getBgmBus(ctx);
  }
}

function getNoiseBuffer(ctx) {
  if (noiseBuffer) return noiseBuffer;
  try {
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.floor(sampleRate * 0.08);
    const buf = ctx.createBuffer(1, length, sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.35));
    }
    noiseBuffer = buf;
    return noiseBuffer;
  } catch {
    return null;
  }
}

function scheduleBgmVoice(ctx, bus, freq, startTime, durationSec, type, peakGain, freqEnd = null) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), startTime + durationSec);
    }
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.01);
  } catch {
    // Ignore audio errors
  }
}

function schedulePercussion(ctx, bus, kind, startTime) {
  if (!kind) return;
  if (kind === 'k') {
    scheduleBgmVoice(ctx, bus, 125, startTime, 0.055, 'sine', 0.022, 42);
    return;
  }
  if (kind === 's') {
    scheduleBgmVoice(ctx, bus, 260, startTime, 0.04, 'triangle', 0.015, 120);
  }
  const buf = getNoiseBuffer(ctx);
  if (!buf) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    const dur = kind === 's' ? 0.045 : 0.022;
    const peak = kind === 's' ? 0.014 : 0.01;
    gain.gain.setValueAtTime(peak, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);
    src.connect(gain);
    gain.connect(bus);
    src.start(startTime);
    src.stop(startTime + dur + 0.005);
  } catch {
    // Ignore audio errors
  }
}

function getCurrentBpm() {
  return bgmHighTempo ? BGM_FAST_BPM : BGM_NORMAL_BPM;
}

function scheduleStepAt(ctx, stepIndex, noteTime, stepDurSec) {
  const bus = getBgmBus(ctx);
  if (!bus) return;

  const melody = MELODY_STEPS[stepIndex];
  if (melody) {
    const [midi, len16] = melody;
    const dur = Math.max(0.04, stepDurSec * len16 * 0.82);
    scheduleBgmVoice(ctx, bus, midiToFreq(midi), noteTime, dur, 'square', 0.024);
  }

  const bassMidi = BASS_STEPS[stepIndex];
  if (bassMidi) {
    const dur = Math.max(0.04, stepDurSec * 0.85);
    scheduleBgmVoice(ctx, bus, midiToFreq(bassMidi), noteTime, dur, 'triangle', 0.028);
  }

  const harmMidi = HARMONY_STEPS[stepIndex];
  if (harmMidi) {
    const dur = Math.max(0.035, stepDurSec * 0.75);
    scheduleBgmVoice(ctx, bus, midiToFreq(harmMidi), noteTime, dur, 'sine', 0.016);
  }

  const perc = PERC_STEPS[stepIndex];
  if (perc) {
    schedulePercussion(ctx, bus, perc, noteTime);
  }
}

export function scheduleBgmWindow() {
  if (!bgmPlaying || !bgmEnabled || !audioUnlocked) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state && ctx.state !== 'running') return;

  const now = ctx.currentTime;
  if (nextNoteTime < now - 0.05) {
    nextNoteTime = now + 0.01;
  }

  while (nextNoteTime < now + SCHEDULE_AHEAD_SEC) {
    const stepDurSec = 60 / getCurrentBpm() / 4;
    scheduleStepAt(ctx, currentStep, nextNoteTime, stepDurSec);
    nextNoteTime += stepDurSec;
    currentStep = (currentStep + 1) % LOOP_STEPS;
  }
}

function ensureSchedulerRunning() {
  if (schedulerTimer !== null) return;
  scheduleBgmWindow();
  schedulerTimer = setInterval(scheduleBgmWindow, LOOKAHEAD_MS);
}

function clearSchedulerTimer() {
  if (schedulerTimer !== null) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

export function startBgm({ reset = false } = {}) {
  if (reset) {
    currentStep = 0;
  }
  if (!bgmEnabled || !audioUnlocked) {
    bgmPlaying = false;
    clearSchedulerTimer();
    return false;
  }
  const ctx = getAudioContext();
  if (ctx) {
    if (reset || !bgmPlaying) {
      resetBgmBus(ctx);
      nextNoteTime = ctx.currentTime + 0.015;
    }
  }
  bgmPlaying = true;
  ensureSchedulerRunning();
  return true;
}

export function stopBgm({ reset = false } = {}) {
  bgmPlaying = false;
  clearSchedulerTimer();
  if (reset) {
    currentStep = 0;
  }
  if (audioCtx) {
    resetBgmBus(audioCtx);
  }
}

export function restartBgm() {
  stopBgm({ reset: true });
  return startBgm({ reset: true });
}

export function setBgmHighTempo(isHigh) {
  bgmHighTempo = Boolean(isHigh);
}

export function unlockAudio() {
  const wasUnlocked = audioUnlocked;
  audioUnlocked = true;
  const ctx = getAudioContext();
  if (ctx && ctx.state !== 'running' && typeof ctx.resume === 'function') {
    try {
      const res = ctx.resume();
      if (res && typeof res.catch === 'function') {
        res.catch(() => {});
      }
    } catch {
      // Ignore resume errors
    }
  }
  return !wasUnlocked;
}

export function isAudioUnlocked() {
  return audioUnlocked;
}

export function isBgmEnabled() {
  return bgmEnabled;
}

export function setBgmEnabled(enabled, { paused = false, over = false } = {}) {
  bgmEnabled = Boolean(enabled);
  saveBgmPreference(bgmEnabled);
  if (!bgmEnabled) {
    stopBgm({ reset: false });
  } else if (audioUnlocked && !paused && !over) {
    startBgm({ reset: false });
  }
  return bgmEnabled;
}

export function toggleBgm({ paused = false, over = false } = {}) {
  return setBgmEnabled(!bgmEnabled, { paused, over });
}

export function syncBgmWithGameState(state) {
  if (!state) return;
  setBgmHighTempo(isHighStack(state.board));
  if (state.paused || state.over || !bgmEnabled || !audioUnlocked) {
    if (bgmPlaying) {
      stopBgm({ reset: false });
    }
  } else if (!bgmPlaying) {
    startBgm({ reset: false });
  }
}

export function getBgmState() {
  return {
    enabled: bgmEnabled,
    playing: bgmPlaying,
    unlocked: audioUnlocked,
    highTempo: bgmHighTempo,
    bpm: getCurrentBpm(),
    currentStep,
  };
}

export function resetAudioForTest({ unlocked = false, enabled = true } = {}) {
  stopBgm({ reset: true });
  audioCtx = null;
  bgmBus = null;
  noiseBuffer = null;
  audioUnlocked = Boolean(unlocked);
  bgmEnabled = Boolean(enabled);
  bgmHighTempo = false;
  currentStep = 0;
}

function playTone(freq, durationSec, type = 'sine', gainPeak = 0.08, freqEnd = null) {
  if (!audioUnlocked) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state && ctx.state !== 'running') return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + durationSec);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.01);
  } catch {
    // Ignore audio errors in restricted/headless environments
  }
}

export function playActionSound(action) {
  switch (action) {
    case 'left':
    case 'right':
      playTone(260, 0.045, 'triangle', 0.05, 300);
      break;
    case 'down':
      playTone(190, 0.035, 'sine', 0.04, 150);
      break;
    case 'rotL':
    case 'rotR':
      playTone(380, 0.06, 'triangle', 0.06, 520);
      break;
    case 'pause':
      playTone(320, 0.08, 'sine', 0.05, 240);
      break;
    case 'restart':
      playTone(300, 0.12, 'triangle', 0.07, 600);
      break;
    default:
      break;
  }
}

export function playEventSound(event) {
  if (!event) return;
  if (event.type === 'lock') {
    playTone(140, 0.08, 'triangle', 0.07, 95);
  } else if (event.type === 'clear') {
    const chain = event.step?.chain ?? 1;
    const base = 330 * Math.pow(1.18, Math.min(chain - 1, 8));
    playTone(base, 0.22, 'sine', 0.09, base * 1.5);
  } else if (event.type === 'gameover') {
    playTone(220, 0.35, 'sawtooth', 0.06, 90);
  }
}
