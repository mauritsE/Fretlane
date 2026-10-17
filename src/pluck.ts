/**
 * A plucked-string sound (Karplus–Strong) for hearing notes while typing them in the tab editor.
 *
 * It has its own AudioContext instead of alphaTab's playNote(): every edit makes alphaTab reload
 * the song's MIDI, which stops a one-note playback that alphaTab's Web Audio output is still
 * starting (its source node starts asynchronously), and the browser then throws "cannot call stop
 * without calling start first". A separate voice can't race with the song's playback.
 */
let ctx: AudioContext | null = null;
const cache = new Map<number, AudioBuffer>();

const SECONDS = 1.4;

function context(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One Karplus–Strong pluck of a MIDI pitch, rendered once and cached. */
function pluckBuffer(c: AudioContext, midi: number): AudioBuffer {
  const key = Math.round(midi);
  const cached = cache.get(key);
  if (cached) return cached;
  const freq = 440 * 2 ** ((key - 69) / 12);
  const length = Math.floor(c.sampleRate * SECONDS);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const out = buffer.getChannelData(0);
  const period = Math.max(2, Math.round(c.sampleRate / freq));
  const ring = new Float32Array(period);
  // A deterministic noise burst, so the same note sounds the same every time.
  let seed = 0x2545f491 ^ key;
  for (let i = 0; i < period; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    ring[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
  }
  // Lower strings ring longer; the averaging filter darkens the tone over time like a real string.
  const decay = key < 45 ? 0.998 : key < 60 ? 0.996 : 0.994;
  let idx = 0;
  for (let i = 0; i < length; i++) {
    const next = (idx + 1) % period;
    const v = decay * 0.5 * (ring[idx] + ring[next]);
    out[i] = ring[idx];
    ring[idx] = v;
    idx = next;
  }
  cache.set(key, buffer);
  return buffer;
}

/** Plays MIDI pitches together (a chord when there are several). */
export function pluck(pitches: number[], volume = 0.35): void {
  const c = context();
  if (!c || !pitches.length) return;
  const gain = c.createGain();
  const now = c.currentTime;
  gain.gain.setValueAtTime(volume / Math.sqrt(pitches.length), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + SECONDS);
  gain.connect(c.destination);
  for (const p of pitches) {
    const src = c.createBufferSource();
    src.buffer = pluckBuffer(c, p);
    src.connect(gain);
    src.start(now);
  }
}

/** Kick and toms: the pitch (Hz) their sine falls to. */
const TOM_HZ: Record<number, number> = { 36: 55, 35: 50, 43: 90, 41: 85, 47: 130, 45: 120, 48: 170, 50: 190 };

/** A short noise burst, made once: the body of snares, hi-hats and cymbals. */
let noise: AudioBuffer | null = null;
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * 1.2), c.sampleRate);
  const out = buffer.getChannelData(0);
  let seed = 0x1b873593;
  for (let i = 0; i < out.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    out[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
  }
  noise = buffer;
  return buffer;
}

/**
 * A rough drum sound for a General MIDI percussion note, for hearing hits typed on a drum track:
 * kick and toms are a falling sine, snare and cymbals filtered noise. Playback uses the real kit.
 */
export function drumHit(gms: number[], volume = 0.5): void {
  const c = context();
  if (!c || !gms.length) return;
  const now = c.currentTime;
  const level = volume / Math.sqrt(gms.length);
  for (const gm of gms) {
    const out = c.createGain();
    out.connect(c.destination);
    const tom = TOM_HZ[gm];
    if (tom) {
      const osc = c.createOscillator();
      osc.frequency.setValueAtTime(tom * 2.5, now);
      osc.frequency.exponentialRampToValueAtTime(tom, now + 0.08);
      const len = gm === 36 || gm === 35 ? 0.35 : 0.5;
      out.gain.setValueAtTime(level * 1.4, now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + len);
      osc.connect(out);
      osc.start(now);
      osc.stop(now + len);
      continue;
    }
    const cymbal = [49, 57, 55, 52, 51, 53, 59].includes(gm);
    const hat = [42, 44, 46].includes(gm);
    const len = cymbal ? 1.1 : gm === 46 ? 0.45 : hat ? 0.06 : 0.18;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const filter = c.createBiquadFilter();
    filter.type = cymbal || hat ? 'highpass' : 'bandpass';
    filter.frequency.value = cymbal || hat ? 7000 : 1800;
    out.gain.setValueAtTime(level * (cymbal ? 0.5 : 1), now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + len);
    src.connect(filter);
    filter.connect(out);
    src.start(now);
    src.stop(now + len);
  }
}
