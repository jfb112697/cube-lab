import { useStore } from './store';

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq0: number, freq1: number, dur: number, peak: number, type: OscillatorType = 'sine', delay = 0) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq0, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, freq: number, peak: number, delay = 0) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 1.1;
  const g = a.createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
}

function on(): boolean {
  return !useStore.getState().muted;
}

let lastTickAt = -1e9;

export const sound = {
  /** Soft UI blip when a new band/selection is highlighted. Throttled so a
   *  pointer sweep across many stickers/arcs can't machine-gun it. */
  tick() {
    if (!on()) return;
    const now = performance.now();
    if (now - lastTickAt < 80) return;
    lastTickAt = now;
    tone(1900, 1500, 0.035, 0.015, 'sine');
  },
  /** Layer starts moving (drag commit / arrow commit). */
  whoosh() {
    if (!on()) return;
    noise(0.16, 700, 0.03);
  },
  /** Satisfying clack when a layer snaps into place. */
  snap(strong = true) {
    if (!on()) return;
    noise(strong ? 0.07 : 0.05, strong ? 1000 : 1400, strong ? 0.14 : 0.06);
    tone(strong ? 240 : 320, 140, 0.05, strong ? 0.1 : 0.045, 'triangle');
  },
  /** Reset pop. */
  pop() {
    if (!on()) return;
    tone(500, 900, 0.09, 0.05, 'sine');
  },
  /** Scramble finished. */
  ready() {
    if (!on()) return;
    tone(660, 660, 0.08, 0.05, 'triangle');
    tone(990, 990, 0.1, 0.05, 'triangle', 0.09);
  },
  /** Victory arpeggio. */
  solved() {
    if (!on()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => tone(f, f, 0.35, 0.07, 'triangle', i * 0.09));
    noise(0.5, 3200, 0.02, 0.45);
  },
};
