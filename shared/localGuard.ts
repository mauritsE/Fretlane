/**
 * Who may talk to the local server. It listens on 127.0.0.1, but any web page the user has open
 * can still send requests to it, so it checks three headers:
 * - `Host` must be a loopback name. A page that rebinds its own domain to 127.0.0.1 (DNS
 *   rebinding) sends its own domain here, and would otherwise be able to read every answer.
 * - `Origin`, when present, must be a loopback http origin. Browsers send it on every cross-site
 *   POST, so a form on another site can't add songs, sign out or spend the riff assistant.
 * - `Sec-Fetch-Site: cross-site` is refused too, which also covers GETs such as `<img src>`
 *   (they carry no Origin). Only the cloud sign-in callback is opened from another site.
 * Requests without these headers (curl, scripts) are allowed: they don't come from a web page.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Paths a page on another site may open: the website sends the browser back here after sign-in. */
const CROSS_SITE_PATHS = new Set(['/api/cloud/callback']);

export interface GuardRequest {
  path: string;
  host?: string;
  origin?: string;
  fetchSite?: string;
}

function hostnameOf(host: string): string | null {
  try {
    const url = new URL(`http://${host}`);
    return url.username || url.password || url.pathname !== '/' ? null : url.hostname;
  } catch {
    return null;
  }
}

export function isLoopbackHost(host: string | undefined): boolean {
  const name = host ? hostnameOf(host) : null;
  return !!name && LOOPBACK_HOSTS.has(name);
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && url.origin === origin && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Why the request is refused, or null when it may go through. */
export function refuseRequest(req: GuardRequest): string | null {
  if (!isLoopbackHost(req.host)) return 'Unexpected Host header';
  if (CROSS_SITE_PATHS.has(req.path)) return null;
  if (req.origin !== undefined && !isLoopbackOrigin(req.origin)) return 'Requests from other websites are not allowed';
  if (req.fetchSite === 'cross-site') return 'Requests from other websites are not allowed';
  return null;
}
