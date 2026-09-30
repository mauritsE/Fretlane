import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dirAssets, startServer } from '../server/app.ts';

describe('startServer with static assets', () => {
  it('serves the UI, falls back to index.html, blocks path traversal, and reports health', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fretlane-app-'));
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
      expect(await (await fetch(`${server.url}/api/health`)).json()).toMatchObject({ ok: true, app: 'fretlane' });
    } finally {
      await server.close();
    }
  });

  it('rejects with EADDRINUSE when the port is taken (the launcher relies on this)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fretlane-app-'));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const a = await startServer({ port, host: '127.0.0.1', libraryDir: path.join(root, 'a') });
    try {
      await expect(startServer({ port, host: '127.0.0.1', libraryDir: path.join(root, 'b') })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await a.close();
    }
  });
});

describe('startServer port handling', () => {
  it('binds a free port when asked for port 0 and reports it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fretlane-app-'));
    const server = await startServer({ port: 0, host: '127.0.0.1', libraryDir: path.join(root, 'lib') });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toBe(`http://localhost:${server.port}`);
      expect((await fetch(`${server.url}/api/health`)).ok).toBe(true);
    } finally {
      await server.close();
    }
  });
});
