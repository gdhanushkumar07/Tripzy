/**
 * Retrieval for Tripzy AI: BM25 over the app's help knowledge base (server/data/kb/*.md, split by
 * heading) plus the user's own memory sent by the app (saved routes, trips, preferences). The top
 * passages go into the model's context so answers about the app and the user are grounded.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Doc = { id: string; title: string; text: string; source: string }

const KB_DIR = 'server/data/kb'
let kb: Doc[] | null = null

export function chunkMarkdown(md: string, source: string): Doc[] {
  const parts = md.split(/\n(?=## )/)
  return parts.map((p, i) => {
    const title = (p.match(/^#{1,3} (.+)$/m)?.[1] ?? source).trim()
    return { id: `${source}#${i}`, title, text: p.replace(/^#{1,3} .+$/m, '').trim(), source }
  }).filter((d) => d.text.length > 20)
}

function loadKb(): Doc[] {
  if (kb) return kb
  kb = []
  if (existsSync(KB_DIR)) for (const f of readdirSync(KB_DIR).filter((x) => x.endsWith('.md'))) kb.push(...chunkMarkdown(readFileSync(join(KB_DIR, f), 'utf8'), f))
  return kb
}

const STOP = new Set('a an the and or of to in on for with is are be it i me my you your we how what where when which can do does from by at as this that'.split(' '))
export const tokens = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t))

/** Okapi BM25 (k1 = 1.4, b = 0.75). */
export function bm25(query: string, docs: Doc[], k = 4): (Doc & { score: number })[] {
  const q = [...new Set(tokens(query))]
  if (!q.length || !docs.length) return []
  const toks = docs.map((d) => tokens(`${d.title} ${d.title} ${d.text}`))
  const avg = toks.reduce((s, t) => s + t.length, 0) / toks.length
  const df = new Map(q.map((t) => [t, toks.filter((d) => d.includes(t)).length]))
  return docs.map((d, i) => {
    const tf = new Map<string, number>()
    for (const t of toks[i]) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const t of q) {
      const f = tf.get(t) ?? 0
      if (!f) continue
      const idf = Math.log(1 + (docs.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
      score += idf * ((f * 2.4) / (f + 1.4 * (1 - 0.75 + (0.75 * toks[i].length) / avg)))
    }
    return { ...d, score }
  }).filter((d) => d.score > 0).sort((a, b) => b.score - a.score).slice(0, k)
}

export const retrieve = (query: string, memory: Doc[] = [], k = 4) => bm25(query, [...loadKb(), ...memory], k)
