/**
 * Sound, made on the spot with the Web Audio API: no audio file, no library, nothing to download.
 * The music is a slow dark-synth loop that tightens as the noise gauge rises, and a few short
 * signatures mark the events of the game. Nothing plays before the player's first click or key.
 */
import { getSettings, onSettings } from './settings.ts';

export type Sfx = 'message' | 'objective' | 'flag' | 'wrong' | 'detect' | 'open' | 'reply';
type Scene = 'off' | 'desk' | 'debrief';

const A1 = 55;
const hz = (semitones: number) => A1 * 2 ** (semitones / 12);
/** Four bars, in semitones above A1: A minor, F, D minor, E. */
const CHORDS = [
  [0, 12, 15, 19, 24],
  [-4, 8, 12, 15, 20],
  [5, 12, 17, 20, 24],
  [-5, 7, 11, 14, 19],
] as const;
const BPM = 76;
const STEP = 60 / BPM / 4;
const STEPS_PER_BAR = 32;

let ctx: AudioContext | null = null;
let master: GainNode;
let musicBus: GainNode;
let sfxBus: GainNode;
let filter: BiquadFilterNode;
let drone: { osc: OscillatorNode[]; gain: GainNode } | null = null;
let analyser: AnalyserNode;
let scene: Scene = 'off';
let tension = 0;
let step = 0;
let nextTime = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function volumes() {
  if (!ctx) return;
  const s = getSettings();
  const now = ctx.currentTime;
  musicBus.gain.setTargetAtTime(s.sound && scene !== 'off' ? s.music * 0.8 : 0, now, 0.4);
  sfxBus.gain.setTargetAtTime(s.sound ? s.sfx * 0.7 : 0, now, 0.05);
}

/** Create the audio graph. Browsers only allow it from a click or a key press. */
export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended' && !document.hidden) void ctx.resume();
    return;
  }
  const Ctor = window.AudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.ratio.value = 12;
  master = ctx.createGain();
  master.gain.value = 0.9;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  master.connect(limiter).connect(analyser).connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  sfxBus = ctx.createGain();
  filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 260;
  filter.Q.value = 0.8;
  filter.connect(musicBus).connect(master);
  sfxBus.connect(master);
  onSettings(volumes);
  setScene(scene);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
}

/** One note: an oscillator through its own envelope, freed when it ends. */
function note(
  out: AudioNode,
  type: OscillatorType,
  freq: number,
  at: number,
  length: number,
  level: number,
  attack = 0.01,
  detune = 0,
) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

function startDrone() {
  if (!ctx || drone) return;
  const gain = ctx.createGain();
  gain.gain.value = 0.16;
  gain.connect(filter);
  const osc = [-7, 7, 0].map((detune, i) => {
    const o = ctx!.createOscillator();
    o.type = i === 2 ? 'sine' : 'sawtooth';
    o.frequency.value = i === 2 ? A1 / 2 : A1;
    o.detune.value = detune;
    o.connect(gain);
    o.start();
    return o;
  });
  drone = { osc, gain };
}

function schedule() {
  if (!ctx || scene === 'off') return;
  while (nextTime < ctx.currentTime + 0.25) {
    const bar = Math.floor(step / STEPS_PER_BAR) % CHORDS.length;
    const chord = CHORDS[bar]!;
    const pos = step % STEPS_PER_BAR;
    const t = nextTime;
    const calm = scene === 'debrief';
    if (pos === 0) {
      // The root follows the chord, and a soft pad holds the bar.
      for (const o of drone?.osc ?? [])
        o.frequency.setTargetAtTime(hz(chord[0]) * (o.type === 'sine' ? 0.5 : 1), t, 0.3);
      for (const n of chord.slice(1, 4))
        note(filter, 'triangle', hz(n + 12), t, STEP * STEPS_PER_BAR, calm ? 0.05 : 0.035, 1.2, 5);
    }
    // The arpeggio comes in with the first noise and fills up as the gauge rises.
    const every = tension > 0.7 ? 1 : tension > 0.4 ? 2 : 4;
    if (!calm && tension > 0.08 && pos % every === 0) {
      const n = chord[1 + ((pos / every) % 4)]!;
      note(filter, 'sawtooth', hz(n + 12), t, STEP * 1.8, 0.03 + tension * 0.09, 0.005);
    }
    // A pulse on the beat once the target's SOC is on alert.
    if (!calm && tension > 0.55 && pos % 4 === 0) {
      note(musicBus, 'sine', 48, t, 0.22, 0.16 + (tension - 0.55) * 0.4, 0.004);
    }
    if (calm && pos % 8 === 0) note(filter, 'sine', hz(chord[4] + 12), t, STEP * 7, 0.03, 0.02);
    step++;
    nextTime += STEP;
  }
}

/** Which music plays: none on the title screen, the desk loop in a mission, a calm one in the debrief. */
export function setScene(next: Scene) {
  scene = next;
  if (!ctx) return;
  if (next !== 'off') {
    startDrone();
    if (timer === undefined) {
      nextTime = ctx.currentTime + 0.1;
      timer = setInterval(schedule, 80);
    }
  }
  volumes();
  setTension(tension);
}

/** 0 to 1, from the noise gauge: opens the filter and thickens the loop. */
export function setTension(k: number) {
  tension = Math.max(0, Math.min(1, k));
  if (!ctx) return;
  const open = scene === 'debrief' ? 420 : 240 + tension ** 1.5 * 2200;
  filter.frequency.setTargetAtTime(open, ctx.currentTime, 0.6);
}

/** A short signature for an event of the game. */
export function playSfx(name: Sfx) {
  if (!ctx || ctx.state !== 'running' || !getSettings().sound) return;
  const t = ctx.currentTime + 0.01;
  const out = sfxBus;
  switch (name) {
    case 'message':
      note(out, 'sine', 880, t, 0.12, 0.12);
      note(out, 'sine', 1174.7, t + 0.09, 0.18, 0.1);
      break;
    case 'reply':
      note(out, 'triangle', 659.3, t, 0.14, 0.08);
      break;
    case 'open':
      note(out, 'sine', 392, t, 0.1, 0.06);
      note(out, 'sine', 587.3, t + 0.05, 0.14, 0.05);
      break;
    case 'objective':
      note(out, 'triangle', 783.99, t, 0.5, 0.12);
      note(out, 'sine', 1567.98, t, 0.4, 0.04);
      break;
    case 'flag':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        note(out, 'triangle', f, t + i * 0.08, 0.5, 0.14);
        note(out, 'sine', f * 2, t + i * 0.08, 0.3, 0.04);
      });
      break;
    case 'wrong':
      note(out, 'square', 155.6, t, 0.16, 0.06);
      note(out, 'square', 146.8, t + 0.12, 0.22, 0.06);
      break;
    case 'detect': {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.9);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 1.05);
      note(out, 'square', 110, t, 0.5, 0.08);
      break;
    }
  }
}

/** For checks: is the context running, and how loud is the output right now (0 to 1). */
export function audioProbe(): { state: string; rms: number; peak: number } {
  if (!ctx) return { state: 'none', rms: 0, peak: 0 };
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  let peak = 0;
  for (const v of data) {
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  return { state: ctx.state, rms: Math.sqrt(sum / data.length), peak };
}
