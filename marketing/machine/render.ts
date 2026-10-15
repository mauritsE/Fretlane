/**
 * Turns a recorded take (record.ts) into a 1080x1920 Short / Reel: the footage in a frame, the
 * hook and song line on top, one label per segment, and an end card over the last seconds of the
 * app's own music. H.264 + AAC, 30 fps, about -14 LUFS. Also renders the release-post image.
 *
 * Drawn parts (text, frame, end card) are HTML pages screenshotted by Playwright, so all of it is
 * TypeScript. Fonts: Inter, installed on the system (`apt install fonts-inter` in CI).
 * The footage is never sped up or slowed down: what you hear is what the app played, in sync.
 */
import type { Browser } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { APP_NAME } from '../../shared/brand.ts';
import type { MediaFile } from './plan.ts';
import type { TakeMeta } from './record.ts';

export const W = 1080;
export const H = 1920;
const FPS = 30;
const BOX = { x: 40, y: 470, w: 1000, h: 1250 }; // footage (the take is 1080x1350, also 4:5)
const COLORS = { bg: '#121419', accent: '#f5b041', text: '#f0f1f5', muted: '#9aa1b1' };
const LOGO = `data:image/png;base64,${readFileSync(new URL('../../build/icon.png', import.meta.url)).toString('base64')}`;

function ff(args: string[]): string {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
}
export function probeDuration(file: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
}
export function mediaInfo(path: string, file: string, width: number, height: number, video: boolean): MediaFile {
  const buf = readFileSync(path);
  return {
    file, sha256: createHash('sha256').update(buf).digest('hex'), bytes: statSync(path).size, width, height,
    ...(video ? { durationSec: Math.round(probeDuration(path) * 10) / 10 } : {}),
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const BASE_CSS = `
* { margin: 0; box-sizing: border-box; }
html, body { background: transparent; font-family: 'Inter', sans-serif; color: ${COLORS.text}; }
.display { font-family: 'Inter Display', 'Inter', sans-serif; }`;

let fontChecked = false;
function requireInter(): void {
  if (fontChecked) return;
  if (!/Inter Display/.test(execFileSync('fc-list', [':', 'family'], { encoding: 'utf8' }))) {
    throw new Error('Inter is not installed: apt install fonts-inter (or put Inter and Inter Display in ~/.fonts)');
  }
  fontChecked = true;
}

/** Screenshots an HTML fragment at w x h into a PNG (transparent where the page is). */
async function drawPng(browser: Browser, html: string, w: number, h: number, out: string): Promise<void> {
  requireInter();
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${BASE_CSS}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  // [data-fit="<px>"]: shrink the text until the element is at most that tall (long song titles).
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-fit]')) {
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollHeight > Number(el.dataset.fit) && size > 20) el.style.fontSize = `${(size -= 2)}px`;
    }
  });
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
}

function frameHtml(hook: string, sub: string): string {
  const [l1, l2 = ''] = hook.split('\n');
  return `
<div style="position:absolute;inset:0;background:${COLORS.bg};
  -webkit-mask: linear-gradient(#000 0 0), url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22${W}%22 height=%22${H}%22><rect x=%22${BOX.x}%22 y=%22${BOX.y}%22 width=%22${BOX.w}%22 height=%22${BOX.h}%22 rx=%2228%22/></svg>');
  -webkit-mask-composite: xor;"></div>
<div style="position:absolute;left:${BOX.x}px;top:${BOX.y}px;width:${BOX.w}px;height:${BOX.h}px;border-radius:28px;box-shadow:0 0 0 2px #2a2e38;"></div>
<div class="display" data-fit="186" style="position:absolute;left:60px;right:60px;top:96px;font-weight:900;font-size:80px;line-height:1.06;letter-spacing:-1.5px;">
  <div>${esc(l1)}</div><div style="color:${COLORS.accent}">${esc(l2)}</div>
</div>
<div style="position:absolute;left:62px;top:300px;font-size:36px;color:${COLORS.muted};font-weight:500;">${esc(sub)}</div>
<div style="position:absolute;left:0;right:0;top:1752px;display:flex;align-items:center;justify-content:center;gap:18px;">
  <img src="${LOGO}" style="width:64px;height:64px;border-radius:14px">
  <div style="font-size:38px;font-weight:800;">${APP_NAME}</div>
  <div style="font-size:32px;color:${COLORS.muted};">· free guitar tab player</div>
</div>`;
}

function labelHtml(label: string): string {
  return `<div style="position:absolute;left:60px;top:378px;display:inline-flex;align-items:center;gap:14px;
    background:${COLORS.accent};color:#16130c;font-weight:800;font-size:38px;padding:12px 26px;border-radius:999px;">
    <span style="font-size:28px">▶</span>${esc(label)}</div>`;
}

function endCardHtml(): string {
  return `<div style="position:absolute;inset:0;background:${COLORS.bg};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:26px;">
    <img src="${LOGO}" style="width:240px;height:240px;border-radius:52px;margin-bottom:20px">
    <div class="display" style="font-size:120px;font-weight:900;letter-spacing:-2px;">${APP_NAME}</div>
    <div style="font-size:48px;font-weight:700;color:${COLORS.accent}">Free guitar tab player</div>
    <div style="font-size:40px;color:${COLORS.muted};">Mac · Windows · Linux · open source</div>
    <div style="font-size:36px;color:${COLORS.text};margin-top:40px;padding:16px 30px;border:2px solid #2a2e38;border-radius:18px;">github.com/mauritsE/Fretlane</div>
  </div>`;
}

/** frames + audio taps -> raw.mp4 (30 fps, 1080x1350) and mix.wav, both from the first frame. Returns t0. */
function assemble(dir: string, meta: TakeMeta): number {
  const frames = JSON.parse(readFileSync(`${dir}/frames.json`, 'utf8')) as { file: string; t: number }[];
  const t0 = frames[0].t;
  // Chrome only sends a frame when the page changes: hold the last one until the take ended.
  const tail = Math.max(0.5, meta.tailEnd - frames[frames.length - 1].t + 0.2);
  const list = frames.map((f, i) => {
    const dt = i + 1 < frames.length ? frames[i + 1].t - f.t : tail;
    return `file '${dir}/${f.file}'\nduration ${Math.max(dt, 0.001).toFixed(4)}\n`;
  });
  list.push(`file '${dir}/${frames[frames.length - 1].file}'\n`);
  writeFileSync(`${dir}/frames.txt`, list.join(''));
  ff(['-f', 'concat', '-safe', '0', '-i', `${dir}/frames.txt`, '-vf', `fps=${FPS},scale=1080:1350:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-crf', '14', `${dir}/raw.mp4`]);
  const length = probeDuration(`${dir}/raw.mp4`);
  const inputs = meta.audio.flatMap((a) => ['-i', `${dir}/${a.file}`]);
  const chains = meta.audio.map((a, i) => {
    const ms = Math.max(0, Math.round((a.start - t0) * 1000));
    return `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${i}]`;
  });
  const ins = meta.audio.map((_, i) => `[a${i}]`).join('');
  ff([...inputs, '-filter_complex', `${chains.join(';')};${ins}amix=inputs=${meta.audio.length}:normalize=0,apad,atrim=0:${length.toFixed(3)}[out]`, '-map', '[out]', `${dir}/mix.wav`]);
  return t0;
}

export interface ShortText {
  hook: string;
  sub: string;
  labels: string[];
}

/** Renders the Short into `outVideo` and a cover still into `outCover`. */
export async function renderShort(browser: Browser, dir: string, text: ShortText, outVideo: string, outCover: string): Promise<void> {
  const meta = JSON.parse(readFileSync(`${dir}/marks.json`, 'utf8')) as TakeMeta;
  if (text.labels.length !== meta.segments.length) throw new Error(`${text.labels.length} labels for ${meta.segments.length} segments`);
  const t0 = assemble(dir, meta);
  await drawPng(browser, frameHtml(text.hook, text.sub), W, H, `${dir}/frame.png`);
  await drawPng(browser, endCardHtml(), W, H, `${dir}/end.png`);
  for (const [i, l] of text.labels.entries()) await drawPng(browser, labelHtml(l), W, H, `${dir}/label-${i}.png`);

  const segs = meta.segments.map(([a, b]) => [a - t0, b - t0]);
  const lastEnd = segs[segs.length - 1][1];
  const tail = meta.tailEnd - t0 - lastEnd;
  const g: string[] = [];
  segs.forEach(([a, b], i) => {
    g.push(`[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS,scale=${BOX.w}:${BOX.h}:flags=lanczos[v${i}]`);
    g.push(`[1:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.04[a${i}]`);
  });
  g.push(`${segs.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${segs.length}:v=1:a=1[fv][fa]`);
  const main = segs.reduce((s, [a, b]) => s + (b - a), 0);
  g.push(`color=c=${COLORS.bg}:s=${W}x${H}:r=${FPS}:d=${main.toFixed(3)}[bg]`);
  g.push(`[bg][fv]overlay=${BOX.x}:${BOX.y}:shortest=1[c0]`);
  g.push(`[c0][2:v]overlay=0:0[c1]`);
  let at = 0;
  let last = 'c1';
  segs.forEach(([a, b], i) => {
    const out = `l${i}`;
    g.push(`[${last}][${4 + i}:v]overlay=0:0:enable='between(t,${at.toFixed(3)},${(at + b - a).toFixed(3)})'[${out}]`);
    at += b - a;
    last = out;
  });
  g.push(`[${last}]format=yuv420p,setsar=1[mainv]`);
  g.push(`[3:v]scale=${W}:${H},setsar=1,format=yuv420p,trim=duration=${tail.toFixed(3)},setpts=PTS-STARTPTS[endv]`);
  g.push(`[1:a]atrim=start=${lastEnd.toFixed(3)}:end=${(lastEnd + tail).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=out:st=${Math.max(0, tail - 1.6).toFixed(3)}:d=1.6[enda]`);
  g.push(`[mainv][fa][endv][enda]concat=n=2:v=1:a=1[v][a0]`);
  g.push(`[a0]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]`);
  ff([
    '-i', `${dir}/raw.mp4`, '-i', `${dir}/mix.wav`, '-i', `${dir}/frame.png`,
    '-loop', '1', '-framerate', String(FPS), '-i', `${dir}/end.png`,
    ...text.labels.flatMap((_, i) => ['-i', `${dir}/label-${i}.png`]),
    '-filter_complex', g.join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', outVideo,
  ]);
  // Cover: a moment in the first segment with the music well under way.
  ff(['-ss', Math.min(6, (segs[0][1] - segs[0][0]) * 0.6).toFixed(2), '-i', outVideo, '-frames:v', '1', '-q:v', '3', outCover]);
}

/** The release post image, 1080x1350 (Instagram's portrait feed size; Facebook shows it as is). */
export async function renderReleaseImage(browser: Browser, version: string, highlights: string[], out: string): Promise<void> {
  // No highlights: the image is just the headline (the caption's TODO still blocks posting).
  const items = highlights.map((h) => `<li style="margin:0 0 22px 0">${esc(h)}</li>`).join('');
  await drawPng(browser, `<div style="position:absolute;inset:0;background:${COLORS.bg};padding:90px 80px;">
    <div style="display:flex;align-items:center;gap:24px;"><img src="${LOGO}" style="width:110px;height:110px;border-radius:26px">
      <div class="display" style="font-size:64px;font-weight:900;">${APP_NAME}</div></div>
    <div class="display" style="font-size:104px;font-weight:900;letter-spacing:-2px;margin-top:70px;line-height:1.02;">Version ${esc(version)}<br><span style="color:${COLORS.accent}">is out</span></div>
    <ul style="font-size:44px;line-height:1.25;margin-top:60px;padding-left:44px;color:${COLORS.text};">${items}</ul>
    <div style="position:absolute;left:80px;bottom:80px;font-size:34px;color:${COLORS.muted};">Free · Mac, Windows, Linux · github.com/mauritsE/Fretlane</div>
  </div>`, 1080, 1350, out);
}
