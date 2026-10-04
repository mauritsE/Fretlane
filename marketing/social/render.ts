/**
 * Lays out the Spotify social images from the real screenshots that capture.ts takes.
 *   npx tsx marketing/social/render.ts
 * Reads marketing/work/social/*.png and the Inter font from marketing/work/fonts-web (see README),
 * writes marketing/social/*.png.
 */
import { chromium } from 'playwright';
import { existsSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;
const SHOTS = `file://${ROOT}work/social/`;
const FONTS = `file://${ROOT}work/fonts-web/package/files/`;
const ICON = `file://${ROOT}../build/icon.png`;

const CSS = `
${[400, 600, 700, 800].map((w) => `@font-face { font-family: Inter; font-weight: ${w}; src: url('${FONTS}inter-latin-${w}-normal.woff2'); }`).join('\n')}
* { box-sizing: border-box; margin: 0; }
body { font-family: Inter, sans-serif; color: #e8eaef; background: #121419; overflow: hidden; }
.frame { position: relative; overflow: hidden; display: flex; flex-direction: column;
  background: radial-gradient(ellipse 60% 55% at 95% 0%, rgba(110, 75, 25, .75), transparent 70%),
              radial-gradient(ellipse 55% 50% at 0% 100%, rgba(30, 45, 80, .8), transparent 70%), #121419; }
.brand { display: flex; align-items: center; gap: 14px; font-weight: 700; }
.brand img { border-radius: 10px; }
.pill { display: inline-block; background: #f5b041; color: #1b1b1b; font-weight: 700; border-radius: 999px; }
h1 { font-weight: 800; letter-spacing: -0.02em; line-height: 1.04; }
h1 em { font-style: normal; color: #f5b041; }
.sub { color: #9aa1b1; line-height: 1.4; }
.shot { border-radius: 14px; border: 3px solid #464c5c; box-shadow: 0 18px 50px rgba(0,0,0,.6); display: block; width: 100%; }
.note { color: #6e7482; text-align: right; }
.foot { color: #9aa1b1; display: flex; justify-content: space-between; align-items: center; }
.foot b { color: #e8eaef; font-weight: 600; }
`;

const brand = (size: number) => `<div class="brand" style="font-size:${size}px"><img src="${ICON}" width="${size * 1.45}" height="${size * 1.45}">Fretlane</div>`;
const headline = 'Now plays along with <em>Spotify</em>';
const sub = 'Link a Spotify track or a YouTube video, and the tab follows the recording, bar by bar.';

const designs: { name: string; w: number; h: number; body: string }[] = [
  {
    name: 'spotify-square-1080',
    w: 1080,
    h: 1080,
    body: `
      <div class="frame" style="width:1080px;height:1080px;padding:64px 64px 52px">
        <div style="display:flex;justify-content:space-between;align-items:center">${brand(34)}<span class="pill" style="font-size:24px;padding:8px 22px">New</span></div>
        <h1 style="font-size:80px;margin-top:44px">${headline}</h1>
        <p class="sub" style="font-size:30px;margin-top:22px;max-width:900px">${sub}</p>
        <div style="margin-top:auto;display:flex;flex-direction:column;align-items:center">
          <img class="shot" src="${SHOTS}lib-2.png" style="width:760px">
          <p class="note" style="font-size:17px;margin-top:10px;align-self:flex-end">Real screenshot of the app</p>
        </div>
        <div class="foot" style="font-size:24px;margin-top:18px"><span>Free and open source</span><b>github.com/mauritsE/Fretlane</b></div>
      </div>`,
  },
  {
    name: 'spotify-landscape-1200x627',
    w: 1200,
    h: 627,
    body: `
      <div class="frame" style="width:1200px;height:627px;padding:46px 52px 40px 56px;flex-direction:row;gap:44px">
        <div style="width:470px;display:flex;flex-direction:column;flex:none">
          ${brand(28)}
          <span class="pill" style="font-size:19px;padding:6px 18px;margin-top:42px;align-self:flex-start">New</span>
          <h1 style="font-size:58px;margin-top:20px">${headline}</h1>
          <p class="sub" style="font-size:22px;margin-top:20px">${sub}</p>
          <div class="foot" style="font-size:19px;margin-top:auto;flex-direction:column;align-items:flex-start;gap:4px"><span>Free and open source</span><b>github.com/mauritsE/Fretlane</b></div>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;min-width:0">
          <img class="shot" src="${SHOTS}player-right.png" style="width:590px">
          <p class="note" style="font-size:14px;margin-top:8px;text-align:left">Real screenshot of the app: sync pins for a Spotify track</p>
        </div>
      </div>`,
  },
  {
    name: 'spotify-story-1080x1920',
    w: 1080,
    h: 1920,
    body: `
      <div class="frame" style="width:1080px;height:1920px;padding:110px 72px 90px">
        <div style="display:flex;justify-content:space-between;align-items:center">${brand(40)}<span class="pill" style="font-size:28px;padding:10px 26px">New</span></div>
        <h1 style="font-size:104px;margin-top:110px">${headline}</h1>
        <p class="sub" style="font-size:38px;margin-top:34px">${sub}</p>
        <img class="shot" src="${SHOTS}lib-2.png" style="margin-top:80px">
        <div style="display:flex;gap:32px;margin-top:36px;align-items:flex-start">
          <img class="shot" src="${SHOTS}sync-crop.png" style="width:500px;flex:none">
          <div style="font-size:32px;line-height:1.35;padding-top:24px">
            <p style="font-weight:700">Pin bars to the track</p>
            <p class="sub" style="font-size:28px;margin-top:10px">One pin sets the start. More pins follow the band when the tempo drifts.</p>
          </div>
        </div>
        <p class="note" style="font-size:20px;margin-top:14px">Real screenshots of the app</p>
        <div class="foot" style="font-size:30px;margin-top:auto;flex-direction:column;gap:8px"><span>Free and open source</span><b>github.com/mauritsE/Fretlane</b></div>
      </div>`,
  },
];

const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--allow-file-access-from-files'] });
for (const d of designs) {
  const page = await browser.newPage({ viewport: { width: d.w, height: d.h } });
  // Opened from a file so it may load the local screenshots and fonts.
  const html = `${ROOT}work/social/${d.name}.html`;
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${d.body}</body></html>`);
  await page.goto(`file://${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').length);
  if (fonts < 3) throw new Error(`${d.name}: Inter did not load (${fonts} faces)`);
  await page.screenshot({ path: `${ROOT}social/${d.name}.png` });
  console.log('wrote', `marketing/social/${d.name}.png`);
  await page.close();
}
await browser.close();
