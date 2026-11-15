import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/core';
import type { Request, Response } from 'express';
import { TripzyProxyController } from '../../../src/nest/tripzy/tripzy-proxy.controller';
import { extractToken, verifyJwtAndLoadUser } from '../../../src/nest/auth-core/jwt-verify';

vi.mock('../../../src/nest/auth-core/jwt-verify', () => ({
  extractToken: vi.fn(() => null),
  verifyJwtAndLoadUser: vi.fn(),
}));

const em = { getRepository: vi.fn(() => ({})) } as unknown as EntityManager;
function response() {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn(), send: vi.fn(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
function request(path: string, overrides: Partial<Request> = {}) {
  return { params: { path }, originalUrl: `/api/tripzy/${path}`, method: 'GET', headers: {}, ...overrides } as Request;
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Tripzy engine boundary', () => {
  it('rejects traversal before calling the engine', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const res = response();
    await new TripzyProxyController(em).proxy(request('../private'), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('forwards anonymous previews and query strings without accepting a forged identity', async () => {
    const fetcher = vi.fn().mockResolvedValue(new globalThis.Response('{"cards":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const res = response();
    await new TripzyProxyController(em).proxy(request('dna/cards', {
      originalUrl: '/api/tripzy/dna/cards?city=jaipur', headers: { 'x-tripzy-user': 'another-user', authorization: 'forged' },
    }), res as unknown as Response);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/api/dna/cards?city=jaipur'), expect.objectContaining({
      method: 'GET', headers: { 'x-tripzy-key': expect.any(String) },
    }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('cache-control', 'no-store');
  });

  it('derives identity from the verified session and preserves JSON writes', async () => {
    vi.mocked(extractToken).mockReturnValueOnce('valid');
    vi.mocked(verifyJwtAndLoadUser).mockResolvedValueOnce({ id: 7, username: 'A B' } as never);
    const fetcher = vi.fn().mockResolvedValue(new globalThis.Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    const res = response();
    await new TripzyProxyController(em).proxy(request('trips', { method: 'POST', body: { title: 'Jaipur' } }), res as unknown as Response);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/api/trips'), expect.objectContaining({
      body: '{"title":"Jaipur"}', headers: expect.objectContaining({ 'x-tripzy-user': '7', 'x-tripzy-user-name': 'A%20B' }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns an actionable error when the engine is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const res = response();
    await new TripzyProxyController(em).proxy(request('dna/cards'), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('unavailable') });
  });
});
