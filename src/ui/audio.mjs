// Synthesized Web Audio sound effects (no external audio assets)

let audioCtx = null;

function getAudioContext() {
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
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freq, durationSec, type = 'sine', gainPeak = 0.08, freqEnd = null) {
  const ctx = getAudioContext();
  if (!ctx) return;
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
