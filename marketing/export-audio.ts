/**
 * Renders a song's audio with Fretlane's own synthesizer (alphaTab audio export), for the video
 * soundtrack:  npx tsx marketing/export-audio.ts <baseUrl> "<song title>" out.wav
 */
import { chromium } from 'playwright';
import { existsSync, writeFileSync } from 'node:fs';

const [BASE, TITLE, OUT] = process.argv.slice(2);
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
const songs = (await (await fetch(`${BASE}/api/songs`)).json()) as { id: string; title: string }[];
const song = songs.find((s) => s.title === TITLE);
if (!song) throw new Error(`No song "${TITLE}"`);
await page.goto(`${BASE}/#/song/${song.id}`);
await page.waitForFunction(() => (window as any).fretlane?.at?.isReadyForPlayback, undefined, { timeout: 30000 });

const sampleRate = 44100;
const b64 = await page.evaluate(async (rate) => {
  const at = (window as any).fretlane.at;
  const exporter = await at.exportAudio({ sampleRate: rate, useSyncPoints: false, masterVolume: 1, metronomeVolume: 0, trackVolume: new Map(), trackTranspositionPitches: new Map(), instrumentVolume: new Map() });
  const parts: Float32Array[] = [];
  for (;;) {
    const chunk = await exporter.render(1000);
    if (!chunk) break;
    parts.push(chunk.samples);
  }
  exporter.destroy();
  const total = parts.reduce((a, p) => a + p.length, 0);
  const pcm = new Int16Array(total);
  let o = 0;
  for (const p of parts) for (let i = 0; i < p.length; i++) pcm[o++] = Math.max(-32768, Math.min(32767, Math.round(p[i] * 32767)));
  let bin = '';
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}, sampleRate);
await browser.close();

// alphaTab renders interleaved stereo.
const data = Buffer.from(b64, 'base64');
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(OUT, Buffer.concat([header, data]));
console.log(`Wrote ${OUT}: ${(data.length / 4 / sampleRate).toFixed(1)} s`);
