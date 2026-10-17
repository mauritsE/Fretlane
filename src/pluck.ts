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

/** General MIDI numbers of the drums that are a pitched thump rather than noise (kick and toms). */
const THUMPS: Record<number, number> = { 36: 55, 43: 90, 47: 120, 50: 160 };

/**
 * A short synthesized drum hit for a General MIDI percussion number, for hearing hits while typing
 * on a drum track: a falling sine for the kick and toms, filtered noise for cymbals and hi-hats, and
 * both for the snare.
 */
export function drumHit(midi: number, volume = 0.5): void {
  const c = context();
  if (!c) return;
  const now = c.currentTime;
  const out = c.createGain();
  out.connect(c.destination);
  const thump = THUMPS[midi];
  if (thump || midi === 38 || midi === 37) {
    const osc = c.createOscillator();
    const g = c.createGain();
    const f = thump ?? 190;
    osc.frequency.setValueAtTime(f * 2.2, now);
    osc.frequency.exponentialRampToValueAtTime(f, now + 0.06);
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (midi === 36 ? 0.35 : 0.22));
    osc.connect(g).connect(out);
    osc.start(now);
    osc.stop(now + 0.4);
  }
  if (!thump) {
    const cymbal = midi === 49 || midi === 51 || midi === 46;
    const seconds = cymbal ? 0.9 : midi === 42 || midi === 44 ? 0.08 : 0.18;
    const buffer = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = midi === 38 || midi === 37 ? 1500 : 6000;
    const g = c.createGain();
    g.gain.setValueAtTime(volume * (midi === 37 ? 0.3 : 0.6), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    src.connect(filter).connect(g).connect(out);
    src.start(now);
  }
}
