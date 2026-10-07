// Checks the copy in appstore/LISTING.md against App Store Connect's limits: node appstore/check-lengths.mjs
import { readFileSync } from 'node:fs';

const md = readFileSync(new URL('./LISTING.md', import.meta.url), 'utf8');
// [heading text that precedes the code block, limit, unit]
const fields = [
  ['**Name** (30)', 30, 'chars'],
  ['**Subtitle** (30)', 30, 'chars'],
  ['**Promotional Text** (170', 170, 'chars'],
  ['**Description** (4000)', 4000, 'chars'],
  ['**Keywords** (100 bytes', 100, 'bytes'],
  ["**What's New in This Version**", 4000, 'chars'],
  ['**Notes** (4000 bytes)', 4000, 'bytes'],
];
let failed = false;
for (const [label, limit, unit] of fields) {
  const at = md.indexOf(label);
  if (at < 0) throw new Error(`Field not found: ${label}`);
  const m = md.slice(at).match(/```\n([\s\S]*?)\n```/);
  const text = m[1];
  const n = unit === 'bytes' ? Buffer.byteLength(text, 'utf8') : [...text].length;
  const ok = n <= limit;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.replace(/\*/g, '').padEnd(32)} ${String(n).padStart(4)} / ${limit} ${unit}`);
}
const kw = md.slice(md.indexOf('**Keywords**')).match(/```\n([\s\S]*?)\n```/)[1];
if (/\s/.test(kw)) (failed = true), console.log('FAIL keywords contain spaces');
process.exit(failed ? 1 : 0);
