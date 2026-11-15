import { readEnv } from '../../app-config';
import { UserSessions } from '../../db/entities/UserSessions.entity';
import { Users } from '../../db/entities/Users.entity';
import { extractToken, verifyJwtAndLoadUser } from '../auth-core/jwt-verify';
import { Public } from '../auth-core/public.decorator';
import { EntityManager } from '@mikro-orm/core';
import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * /api/tripzy/* → Tripzy Intelligence engine (FastAPI, loopback only).
 *
 * The engine is never reachable from the browser directly. This proxy resolves
 * the session (when there is one) and forwards the user's id together with a
 * shared secret, so the engine can enforce ownership of every capsule, link and
 * profile. Anonymous visitors may only reach the planning-preview endpoints the
 * engine itself allows without a user (brief parsing, DNA cards, compose, and
 * reading the unowned draft they just composed).
 */
const MAX_BODY = 12 * 1024 * 1024;

@Public('Anonymous trip planning preview; the engine enforces per-user ownership from the forwarded, keyed user id')
@Controller('api/tripzy')
export class TripzyProxyController {
  constructor(private readonly em: EntityManager) {}

  // response-contract-exempt: transparent engine proxy writes JSON, binary uploads and SSE through @Res().
  @All('*path')
  async proxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { engineUrl, engineKey } = readEnv().tripzy;
    const token = extractToken(req);
    const user = token
      ? await verifyJwtAndLoadUser(token, this.em.getRepository(Users), this.em.getRepository(UserSessions))
      : null;

    const rest = (req.params as Record<string, unknown>).path ?? '';
    const sub = (Array.isArray(rest) ? rest.join('/') : String(rest)).replace(/^\/+/, '');
    if (sub.includes('..')) {
      res.status(400).json({ error: 'Bad path' });
      return;
    }
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const headers: Record<string, string> = { 'x-tripzy-key': engineKey };
    if (user) {
      headers['x-tripzy-user'] = String(user.id);
      headers['x-tripzy-user-name'] = encodeURIComponent(String(user.username ?? ''));
    }

    let body: string | Buffer | undefined;
    const ctype = String(req.headers['content-type'] ?? '');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (ctype.startsWith('multipart/form-data')) {
        // Ticket uploads: stream the raw multipart body through unchanged.
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req as AsyncIterable<Buffer>) {
          size += c.length;
          if (size > MAX_BODY) {
            res.status(413).json({ error: 'File too large (max 12 MB)' });
            return;
          }
          chunks.push(c);
        }
        body = Buffer.concat(chunks);
        headers['content-type'] = ctype;
      } else {
        body = JSON.stringify(req.body ?? {});
        headers['content-type'] = 'application/json';
      }
    }

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${engineUrl}/api/${sub}${qs}`, {
        method: req.method,
        headers,
        body,
        signal: AbortSignal.timeout(sub === 'trips/compose' ? 120_000 : 45_000),
      });
    } catch {
      res.status(502).json({ error: 'Tripzy Intelligence is unavailable. Please try again shortly.' });
      return;
    }

    res.status(upstream.status);
    const type = upstream.headers.get('content-type') ?? 'application/json';
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'no-store');
    if (type.startsWith('text/event-stream') && upstream.body) {
      // Agent progress: relay each event as it arrives.
      res.setHeader('x-accel-buffering', 'no');
      res.flushHeaders();
      const reader = upstream.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }
}
