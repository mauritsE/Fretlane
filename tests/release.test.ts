import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startHereText } from '../release/startHere.ts';
import { dirAssets, startServer } from '../server/app.ts';

describe('startHereText', () => {
  it('gives each platform its own opening instructions', () => {
    expect(startHereText('windows', '1.2.3')).toContain('Songstarr.exe');
    expect(startHereText('windows', '1.2.3')).toContain('Run anyway');
    expect(startHereText('macos', '1.2.3')).toContain('Open Anyway');
    expect(startHereText('macos', '1.2.3')).toContain('macos-arm64');
    expect(startHereText('linux', '1.2.3')).toContain('./Songstarr');
    expect(startHereText('linux', '1.2.3')).toContain('SONGSTARR 1.2.3');
  });

  it('avoids developer jargon in the user guide', () => {
    for (const p of ['windows', 'macos', 'linux'] as const) {
      expect(startHereText(p, '1').toLowerCase()).not.toMatch(/\bnpm\b|node\.js|\bserver\b|\bport\b/);
    }
  });
});

describe('startServer with static assets', () => {
  it('serves the UI, falls back to index.html, blocks path traversal, and reports health', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'songstarr-app-'));
    const dist = path.join(root, 'dist');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>x</title>');
    await writeFile(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
    await writeFile(path.join(root, 'secret.txt'), 'nope');
    const port = 20000 + Math.floor(Math.random() * 20000);
    const server = await startServer({ port, host: '127.0.0.1', libraryDir: path.join(root, 'lib'), assets: dirAssets(dist) });
    try {
      const js = await fetch(`${server.url}/assets/app.js`);
      expect(js.headers.get('content-type')).toBe('text/javascript');
      expect(await js.text()).toBe('console.log(1)');
      expect(await (await fetch(`${server.url}/#/song/x`)).text()).toContain('<title>x</title>');
      expect(await (await fetch(`${server.url}/some/deep/link`)).text()).toContain('<title>x</title>');
      const traversal = await fetch(`${server.url}/..%2Fsecret.txt`);
      expect(await traversal.text()).not.toContain('nope');
      expect(await (await fetch(`${server.url}/api/health`)).json()).toMatchObject({ ok: true, app: 'songstarr' });
    } finally {
      await server.close();
    }
  });

  it('rejects with EADDRINUSE when the port is taken (the launcher relies on this)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'songstarr-app-'));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const a = await startServer({ port, host: '127.0.0.1', libraryDir: path.join(root, 'a') });
    try {
      await expect(startServer({ port, host: '127.0.0.1', libraryDir: path.join(root, 'b') })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await a.close();
    }
  });
});
