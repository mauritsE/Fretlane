/**
 * Drafts the next posts: picks songs and formats for the coming slots, records each Short in the
 * real app, renders it, and writes one queue file per post to marketing/queue/. Nothing is posted
 * here; merging the draft PR is the approval, post.ts does the posting.
 *
 *   npm run build
 *   npx tsx marketing/machine/draft.ts [--days 7] [--from 2026-10-17T00:00:00Z] [--upload]
 *   npx tsx marketing/machine/draft.ts --release v0.4.0 --notes-file notes.md [--upload]
 *
 * Media goes to marketing/work/machine/ (not in git). With --upload it is also attached to the
 * "marketing-media" pre-release on GitHub (gh CLI), which gives every file a public URL: Instagram
 * and Facebook fetch media from a URL. Writes marketing/work/machine/pr-body.md for the PR.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SONGBOOK } from '../../songbook/songs.ts';
import {
  onScreenText, pickShorts, postId, releaseCopy, releaseHighlights, releaseSlot, shortCopy, slotsBetween, tourTracks,
  validatePost, type HistoryEntry, type MediaFile, type PostedRecord, type QueuedPost,
} from './plan.ts';
import { MEDIA_TAG, POSTED, QUEUE, REPO, ROOT, readJsonDir } from './queue.ts';
import { launchBrowser, recordShort } from './record.ts';
import { mediaInfo, renderReleaseImage, renderShort } from './render.ts';

const WORK = path.join(ROOT, 'marketing/work/machine');

function history(queued: QueuedPost[], posted: PostedRecord[]): HistoryEntry[] {
  return [...queued, ...posted.map((p) => p.post)]
    .filter((p) => p.song)
    .map((p) => ({ songId: p.song!.id, format: p.song!.format, at: p.scheduledAt }));
}

/** Starts the production server on a fresh library; resolves to its URL and a stop function. */
async function startServer(): Promise<{ base: string; stop: () => void }> {
  if (!existsSync(path.join(ROOT, 'dist/index.html'))) throw new Error('no dist/: run `npm run build` first');
  const port = 5300 + Math.floor(Math.random() * 500);
  const library = mkdtempSync(path.join(tmpdir(), 'fretlane-marketing-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--serve-dist'], {
    cwd: ROOT, env: { ...process.env, FRETLANE_PORT: String(port), FRETLANE_LIBRARY: library }, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/songs`)).ok) break;
    } catch { /* not up yet */ }
    if (i === 99) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
  return { base, stop: () => { child.kill(); rmSync(library, { recursive: true, force: true }); } };
}

function upload(files: string[]): void {
  try {
    execFileSync('gh', ['release', 'view', MEDIA_TAG, '--repo', REPO], { stdio: 'ignore' });
  } catch {
    execFileSync('gh', ['release', 'create', MEDIA_TAG, '--repo', REPO, '--prerelease', '--title', 'Marketing media (not a release)',
      '--notes', 'Videos and images for social posts, attached by the marketing machine (marketing/machine/). Not an app release: the downloads are in the latest release.'], { stdio: 'inherit' });
  }
  execFileSync('gh', ['release', 'upload', MEDIA_TAG, '--repo', REPO, '--clobber', ...files], { stdio: 'inherit' });
}

const mediaUrl = (file: string) => `https://github.com/${REPO}/releases/download/${MEDIA_TAG}/${file}`;

function prBody(posts: QueuedPost[], uploaded: boolean): string {
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const lines = [
    'Drafted by the marketing machine. **Merging this PR approves these posts**; they go out at their time (Amsterdam).',
    'To change one, edit its JSON in `marketing/queue/`. To drop one, delete its file. Close the PR to post none.',
    '',
  ];
  for (const p of posts) {
    const v = p.media.video ?? p.media.image!;
    const cover = p.media.cover ?? p.media.image;
    lines.push(`### ${when(p.scheduledAt)}: ${p.song ? `${p.song.title} (${p.song.format})` : `release ${p.release!.tag}`}`);
    if (uploaded && cover?.url) lines.push(`<a href="${v.url}"><img src="${cover.url}" width="270"></a>`, '', `[▶ ${v.file}](${v.url}) · ${v.durationSec ? `${v.durationSec} s · ` : ''}${(v.bytes / 1e6).toFixed(1)} MB`);
    else lines.push(`Media: \`marketing/work/machine/${v.file}\` (not uploaded)`);
    const problems = validatePost(p);
    if (problems.length) lines.push('', `> ⚠ **Fix before merging:** ${problems.join('; ')}`);
    for (const pl of ['youtube', 'instagram', 'facebook'] as const) {
      const t = p[pl];
      if (!t) continue;
      const text = 'title' in t ? `${t.title}\n\n${t.description}` : 'caption' in t ? t.caption : t.message;
      lines.push('', `<details><summary>${pl}</summary>\n\n\`\`\`\n${text}\n\`\`\`\n</details>`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      days: { type: 'string', default: '7' },
      from: { type: 'string' },
      upload: { type: 'boolean', default: false },
      release: { type: 'string' },
      'notes-file': { type: 'string' },
    },
  });
  mkdirSync(WORK, { recursive: true });
  mkdirSync(QUEUE, { recursive: true });
  const queued = readJsonDir<QueuedPost>(QUEUE);
  const posted = readJsonDir<PostedRecord>(POSTED);
  const from = values.from ? new Date(values.from) : new Date();
  const browser = await launchBrowser();
  const made: QueuedPost[] = [];
  const files: string[] = [];
  const attach = (m: MediaFile) => (values.upload ? { ...m, url: mediaUrl(m.file) } : m);

  try {
    if (values.release) {
      const tag = values.release;
      const notes = values['notes-file'] ? readFileSync(values['notes-file'], 'utf8') : '';
      const highlights = releaseHighlights(notes);
      const at = releaseSlot(from);
      const id = postId(at, `release ${tag}`);
      const image = path.join(WORK, `${id}.png`);
      await renderReleaseImage(browser, tag.replace(/^v/, ''), highlights, image);
      files.push(image);
      made.push({
        id, kind: 'release', scheduledAt: at.toISOString(),
        release: { tag, url: `https://github.com/${REPO}/releases/tag/${tag}` },
        media: { image: attach(mediaInfo(image, path.basename(image), 1080, 1350, false)) },
        ...releaseCopy(tag, highlights),
      });
    } else {
      const taken = new Set(queued.concat(posted.map((p) => p.post)).filter((p) => p.kind === 'short').map((p) => p.scheduledAt));
      const slots = slotsBetween(from, Number(values.days)).filter((s) => !taken.has(s.toISOString()));
      const picks = pickShorts(SONGBOOK, history(queued, posted), slots);
      if (!picks.length) console.log('No open slots in that window.');
      const server = picks.length ? await startServer() : undefined;
      try {
        for (const { at, song, format } of picks) {
          const id = postId(at, `${song.id} ${format}`);
          console.log(`${id}: recording ${song.title} (${format})`);
          const take = path.join(WORK, 'takes', id);
          await recordShort(browser, server!.base, { title: song.title, tour: tourTracks(song) }, format, take);
          const video = path.join(WORK, `${id}.mp4`);
          const cover = path.join(WORK, `${id}-cover.jpg`);
          await renderShort(browser, take, onScreenText(song, format), video, cover);
          rmSync(take, { recursive: true, force: true });
          files.push(video, cover);
          made.push({
            id, kind: 'short', scheduledAt: at.toISOString(), song: { id: song.id, title: song.title, format },
            media: {
              video: attach(mediaInfo(video, path.basename(video), 1080, 1920, true)),
              cover: attach(mediaInfo(cover, path.basename(cover), 1080, 1920, false)),
            },
            ...shortCopy(song, format),
          });
        }
      } finally {
        server?.stop();
      }
    }
  } finally {
    await browser.close();
  }

  if (values.upload && files.length) upload(files);
  for (const p of made) {
    writeFileSync(path.join(QUEUE, `${p.id}.json`), `${JSON.stringify(p, null, 2)}\n`);
    const problems = validatePost(p);
    console.log(`${p.id}: ${problems.length ? `needs attention: ${problems.join('; ')}` : 'ok'}`);
  }
  writeFileSync(path.join(WORK, 'pr-body.md'), prBody(made, values.upload));
  console.log(`${made.length} post(s) drafted. PR text: ${path.relative(ROOT, path.join(WORK, 'pr-body.md'))}`);
}

await main();
