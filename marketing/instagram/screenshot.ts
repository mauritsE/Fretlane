/**
 * Landscape screenshot of the real app (player mid-song, cursor running) for the link-preview card.
 *   npx tsx marketing/instagram/screenshot.ts http://localhost:5183   -> marketing/work/ig/landscape.png
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5183';
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 2 });
await page.goto(BASE);
await page.waitForSelector('.song-card');
await page.click('.song-card[data-title="In the Hall of the Mountain King"] .card-link');
await page.waitForSelector('.at-host svg');
await page.waitForSelector('.at-overlay.hidden', { state: 'attached' });
await page.click('.track-list li:nth-child(1)'); // the melody tab, whatever track was open last
await page.waitForSelector('.at-overlay.hidden', { state: 'attached' });
await page.click('button.play');
await page.waitForFunction(() => (window as any).fretlane.at.playerState === 1);
await page.waitForTimeout(3300);
await page.click('button.play');
await page.waitForTimeout(400);
await page.screenshot({ path: new URL('../work/ig/landscape.png', import.meta.url).pathname });
await browser.close();
