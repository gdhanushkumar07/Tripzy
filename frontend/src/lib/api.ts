import type { Brief, Capsule, Proposal, Step } from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      msg = (await r.json()).detail ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return r.json();
}

const post = <T,>(path: string, body: unknown) => req<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  parseBrief: (text: string) => post<Brief>("/api/brief/parse", { text }),
  cards: () => req<{ id: string; a: { label: string; emoji: string }; b: { label: string; emoji: string } }[]>("/api/dna/cards"),
  trip: async (id: string) => {
    // offline-first: remember the last good capsule so the Live screen works without network
    try {
      const c = await req<Capsule>(`/api/trips/${id}`);
      cacheCapsule(c);
      return c;
    } catch (e) {
      const cached = localCapsule(id);
      if (cached) return cached;
      throw e;
    }
  },
  route: (id: string, day: number) => req<{ line: [number, number][]; points: [number, number][] }>(`/api/trips/${id}/route/${day}`),
  edit: (id: string, text: string) =>
    post<{ capsule: Capsule; messages: string[]; changes?: { day: number; added: string[]; removed: string[] }[] }>(`/api/trips/${id}/edit`, { text }),
  stay: (id: string, stay_id: string) => post<Capsule>(`/api/trips/${id}/stay`, { stay_id }),
  choose: (id: string, day: number, block_id: string, place_id: string) => post<Capsule>(`/api/trips/${id}/choose`, { day, block_id, place_id }),
  booking: (id: string, b: Record<string, unknown>) => post<Capsule>(`/api/trips/${id}/bookings`, b),
  parseTicket: (text: string, city_key: string) => post<Record<string, string>>("/api/bookings/parse", { text, city_key }),
  ripple: (id: string, day: number, now: string, event: Record<string, unknown>) => post<Proposal>(`/api/trips/${id}/ripple`, { day, now, event }),
  accept: (id: string, pid: string) => post<Capsule>(`/api/trips/${id}/ripple/${pid}/accept`, {}),
  reject: (id: string, pid: string) => post<Capsule>(`/api/trips/${id}/ripple/${pid}/reject`, {}),
  feedback: (id: string, body: { day: number; block_id: string; reaction: string; actual_dwell?: number }) =>
    post<{ learned: string[]; dna_summary: string[] }>(`/api/trips/${id}/feedback`, body),
  retune: (id: string, from_day: number) => post<Capsule>(`/api/trips/${id}/retune`, { from_day }),
  expense: (id: string, day: number, amount: number, label: string) => post<Capsule["budget"]>(`/api/trips/${id}/expense`, { day, amount, label }),
};

export function cacheCapsule(c: Capsule) {
  try {
    localStorage.setItem(`tripzy:capsule:${c.id}`, JSON.stringify(c));
    localStorage.setItem("tripzy:last", c.id);
  } catch {
    /* storage may be unavailable */
  }
}

export function localCapsule(id: string): Capsule | null {
  try {
    const s = localStorage.getItem(`tripzy:capsule:${id}`);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function lastTripId(): string | null {
  try {
    return localStorage.getItem("tripzy:last");
  } catch {
    return null;
  }
}

/** Compose streams agent progress over SSE (POST, so we parse the stream by hand). */
export async function composeStream(
  body: { brief: Brief; swipes: Record<string, string> },
  onStep: (s: Step) => void,
): Promise<string> {
  const r = await fetch(BASE + "/api/trips/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) throw new Error(`Compose failed (${r.status})`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let id = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split(/\r?\n\r?\n/);
    buf = parts.pop() ?? "";
    for (const part of parts) {
      let ev = "message";
      let data = "";
      for (const line of part.split(/\r?\n/)) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (ev === "step") onStep(parsed);
      else if (ev === "done") id = parsed.id;
      else if (ev === "error") throw new Error(parsed.message);
    }
  }
  if (!id) throw new Error("Compose ended without a trip");
  return id;
}

export const mapsLink = (lat?: number | null, lon?: number | null, name?: string) =>
  lat && lon ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}` : `https://www.google.com/maps/search/${encodeURIComponent(name ?? "")}`;

export const rupees = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
