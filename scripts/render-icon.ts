/** Renders build/icon.svg to build/icon.png (1024x1024), used by electron-builder for all platforms. */
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';

const svg = readFileSync('build/icon.svg', 'utf8');
const executablePath = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`);
await page.screenshot({ path: 'build/icon.png', omitBackground: true });
await browser.close();
console.log('wrote build/icon.png');
