import { createHash, timingSafeEqual } from 'node:crypto';

const challenge = { 'WWW-Authenticate': 'Basic realm="Support Copilot", charset="UTF-8"' };
function problem(status, code, message, headers) {
  return Object.assign(new Error(message), { status, code, ...(headers ? { headers: { ...headers } } : {}) });
}
function digest(value) { return createHash('sha256').update(value).digest(); }
function rejectAuth() { throw problem(401, 'AUTH_REQUIRED', 'Authentication is required.', challenge); }

/** Local policy is preserved; public access is an explicit, authenticated opt-in. */
export function createRequestAccessPolicy({ allowRemote = false, publicOrigin = null, adminUsername = 'admin', adminPassword = null } = {}) {
  if (publicOrigin === null || publicOrigin === undefined || publicOrigin === '') {
    return function checkLocal(request) {
      const remote = request.socket.remoteAddress;
      if (!allowRemote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) throw problem(403, 'LOCAL_ONLY', 'This console is available on loopback only.');
      let host;
      try { host = new URL(`http://${request.headers.host || ''}`); }
      catch { throw problem(403, 'INVALID_HOST', 'A loopback Host header is required.'); }
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) || host.username || host.password) throw problem(403, 'INVALID_HOST', 'A loopback Host header is required.');
      if (request.headers.origin) {
        let origin;
        try { origin = new URL(request.headers.origin); }
        catch { throw problem(403, 'INVALID_ORIGIN', 'Origin is not allowed.'); }
        if (origin.origin !== host.origin) throw problem(403, 'INVALID_ORIGIN', 'Origin is not allowed.');
      }
      if (request.headers['sec-fetch-site'] === 'cross-site') throw problem(403, 'INVALID_ORIGIN', 'Cross-site requests are not allowed.');
    };
  }
  let origin;
  try { origin = new URL(publicOrigin); } catch { throw new Error('Invalid public access configuration.'); }
  if (typeof publicOrigin !== 'string' || !allowRemote || origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || ![origin.origin, `${origin.origin}/`].includes(publicOrigin)) throw new Error('Invalid public access configuration.');
  if (typeof adminUsername !== 'string' || !adminUsername || /[:\x00-\x1f\x7f]/u.test(adminUsername) || typeof adminPassword !== 'string' || adminPassword.length < 16 || /[\x00-\x1f\x7f]/u.test(adminPassword)) throw new Error('Public access requires an administrator username and a password of at least 16 characters.');
  const expected = digest(`${adminUsername}:${adminPassword}`);
  return function checkPublic(request) {
    const headers = request.headers;
    if (headers.host !== origin.host) throw problem(403, 'INVALID_HOST', 'Host is not allowed.');
    const externalNavigation = ['GET', 'HEAD'].includes(request.method) && headers['sec-fetch-mode'] === 'navigate' && headers['sec-fetch-dest'] === 'document';
    if ((headers.origin !== undefined && headers.origin !== origin.origin) || (headers['sec-fetch-site'] === 'cross-site' && !externalNavigation)) throw problem(403, 'INVALID_ORIGIN', 'Origin is not allowed.');
    const raw = request.rawHeaders || [];
    let authCount = 0;
    for (let i = 0; i < raw.length; i += 2) if (String(raw[i]).toLowerCase() === 'authorization') authCount++;
    if (authCount > 1 || (request.headersDistinct?.authorization?.length ?? 0) > 1) rejectAuth();
    const authorization = headers.authorization;
    if (typeof authorization !== 'string') rejectAuth();
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
    if (!match || match[1].length % 4 !== 0) rejectAuth();
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.toString('base64') !== match[1]) rejectAuth();
    if (!timingSafeEqual(digest(bytes), expected)) rejectAuth();
  };
}
