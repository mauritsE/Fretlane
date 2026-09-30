// Copies the licences of everything shipped inside the desktop app into release/licenses/,
// which electron-builder places in the app's resources/licenses folder.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const out = 'release/licenses';
mkdirSync(out, { recursive: true });
const files = [
  ['LICENSE', 'Fretlane-LICENSE-MIT.txt'],
  ['node_modules/@coderline/alphatab/LICENSE', 'alphaTab-LICENSE-MPL-2.0.txt'],
  ['node_modules/@coderline/alphatab/dist/font/Bravura-OFL.txt', 'Bravura-font-OFL.txt'],
  ['node_modules/@coderline/alphatab/dist/soundfont/LICENSE', 'Sonivox-soundfont-LICENSE.txt'],
];
for (const [src, dest] of files) {
  if (!existsSync(src)) throw new Error(`Missing licence file ${src}`);
  copyFileSync(src, `${out}/${dest}`);
}
console.log(`Collected ${files.length} licence files into ${out}`);
