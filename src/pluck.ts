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
