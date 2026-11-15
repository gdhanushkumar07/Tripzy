import type { Express } from 'express';
import { request } from 'node:http';

/** Keep the Firebase travel workspace isolated from the platform's API and cookies. */
export function applyTravelWorkspace(app: Express, port = 8787): void {
  app.use('/travel', (req, res) => {
    const upstream = request({
      hostname: '127.0.0.1', port,
      path: `/travel${req.url}`, method: req.method,
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
        ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}),
        'x-forwarded-for': req.ip || req.socket.remoteAddress || 'unknown',
      },
    }, (response) => {
      res.status(response.statusCode || 502);
      for (const name of ['content-type', 'cache-control', 'etag', 'last-modified', 'location']) {
        const value = response.headers[name];
        if (value) res.setHeader(name, value);
      }
      // Only this separate document needs Firebase; preserve the platform's CSP elsewhere.
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://en.wikipedia.org; frame-src https://*.firebaseapp.com https://accounts.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.setTimeout(90_000, () => upstream.destroy(new Error('Travel workspace timed out')));
    upstream.on('error', () => {
      if (!res.headersSent) res.status(503).json({ error: 'The travel workspace is temporarily unavailable. Your existing trips are still available from the dashboard.' });
      else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
}
