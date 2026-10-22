import { describe, expect, it } from 'vitest';
import { isLoopbackHost, isLoopbackOrigin, refuseRequest } from '../shared/localGuard.ts';

describe('isLoopbackHost', () => {
  it('accepts loopback names with or without a port', () => {
    for (const host of ['127.0.0.1:5173', 'localhost:5173', 'localhost', '[::1]:5173', 'LOCALHOST:80']) expect(isLoopbackHost(host), host).toBe(true);
  });
  it('refuses other names, including look-alikes used for DNS rebinding', () => {
    for (const host of [undefined, '', 'evil.example:5173', '127.0.0.1.evil.example', 'localhost.evil.example:5173', 'a@localhost', 'localhost/x', '192.168.1.5:5173'])
      expect(isLoopbackHost(host), String(host)).toBe(false);
  });
});

describe('isLoopbackOrigin', () => {
  it('accepts the app on any loopback port (the Vite dev server is another port)', () => {
    expect(isLoopbackOrigin('http://localhost:5173')).toBe(true);
    expect(isLoopbackOrigin('http://127.0.0.1:5174')).toBe(true);
    expect(isLoopbackOrigin('http://[::1]:5173')).toBe(true);
  });
  it('refuses other sites, https look-alikes and the opaque "null" origin', () => {
    for (const origin of ['null', 'https://evil.example', 'http://localhost.evil.example', 'https://localhost:5173', 'http://localhost:5173/x', ''])
      expect(isLoopbackOrigin(origin), origin).toBe(false);
  });
});

describe('refuseRequest', () => {
  const app = { host: 'localhost:5173' };
  it('lets the app and command-line clients through', () => {
    expect(refuseRequest({ ...app, path: '/api/songs' })).toBeNull();
    expect(refuseRequest({ ...app, path: '/api/songs', origin: 'http://localhost:5173', fetchSite: 'same-origin' })).toBeNull();
    expect(refuseRequest({ ...app, path: '/', fetchSite: 'none' })).toBeNull();
  });
  it('refuses a rebound domain even when its request looks same-origin', () => {
    expect(refuseRequest({ path: '/api/songs', host: 'attacker.example:5173', origin: 'http://attacker.example:5173', fetchSite: 'same-origin' })).toMatch(/Host/);
    expect(refuseRequest({ path: '/index.html', host: 'attacker.example:5173' })).toMatch(/Host/);
  });
  it('refuses a cross-site form POST and a cross-site <img> GET', () => {
    expect(refuseRequest({ ...app, path: '/api/songs', origin: 'https://evil.example', fetchSite: 'cross-site' })).not.toBeNull();
    expect(refuseRequest({ ...app, path: '/api/cloud/logout', origin: 'null' })).not.toBeNull();
    expect(refuseRequest({ ...app, path: '/api/fetch', fetchSite: 'cross-site' })).not.toBeNull();
  });
  it('lets the website send the browser back to the sign-in callback, but only on a loopback Host', () => {
    expect(refuseRequest({ ...app, path: '/api/cloud/callback', fetchSite: 'cross-site' })).toBeNull();
    expect(refuseRequest({ path: '/api/cloud/callback', host: 'attacker.example:5173', fetchSite: 'cross-site' })).not.toBeNull();
  });
});
