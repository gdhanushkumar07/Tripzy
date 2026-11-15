/**
 * AI with live web context (optional): Tavily web search for current news about a
 * place (closures, festivals, crowds), then Gemini reads the results and returns a
 * short verdict with sources. Both are free tiers; without keys the planner uses
 * only the deterministic checks (weather, AQI, opening hours).
 */
import { cached, env, fetchJson, HOUR, providerFailed, providerUp } from '../lib'

export type LiveCheck = { verdict: 'good' | 'caution' | 'avoid'; note: string; sources: { title: string; url: string }[]; by: 'ai' }

type TavilyResult = { title: string; url: string; content: string; published_date?: string }

export function webSearch(query: string): Promise<TavilyResult[]> {
  const key = env('TAVILY_API_KEY')
  if (!key) return Promise.resolve([])
  return cached(`tavily:${query}`, 12 * HOUR, async () => {
    const j = await fetchJson<{ results: TavilyResult[] }>('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, topic: 'news', days: 14, max_results: 5, search_depth: 'basic' }),
    })
    return j.results ?? []
  })
}

/**
 * One Gemini generateContent call with failover. Models get retired (404) or overloaded (503/429)
 * and the newest ones can be slow, so Tripzy tries GEMINI_MODEL (if set), then a chain of current
 * Flash models, each with a short timeout, skipping a model for a few minutes after it fails.
 */
const CHAIN = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest']
export async function geminiGenerate<T>(body: unknown, timeoutMs = 15000): Promise<T> {
  const key = env('GEMINI_API_KEY')!
  const models = [...new Set([env('GEMINI_MODEL'), ...CHAIN].filter((m): m is string => !!m))]
  let last: unknown
  for (const model of models) {
    if (!providerUp(`gemini:${model}`)) continue
    try {
      return await fetchJson<T>(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs, body: JSON.stringify(body),
      })
    } catch (e) {
      last = e
      providerFailed(`gemini:${model}`, e)
      if (!/answered (404|429|500|503)|timed out/.test((e as Error).message)) throw e
    }
  }
  throw last ?? new Error('No Gemini model available')
}

export async function gemini(prompt: string, json = true): Promise<string | null> {
  if (!env('GEMINI_API_KEY')) return null
  const j = await geminiGenerate<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>({
    contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}) },
  })
  return j.candidates?.[0]?.content?.parts?.[0]?.text ?? null
}

export const aiEnabled = () => !!(env('GEMINI_API_KEY') && env('TAVILY_API_KEY'))

/** Is this place a good idea on this date? AI reads fresh search results; never invents facts. */
export function liveCheck(name: string, city: string, date: string): Promise<LiveCheck | null> {
  if (!aiEnabled()) return Promise.resolve(null)
  return cached(`check:${name}:${city}:${date}`, 6 * HOUR, async () => {
    const results = await webSearch(`${name} ${city} closed OR open OR timings OR festival OR crowd ${date.slice(0, 7)}`)
    if (!results.length) return null
    const snippets = results.map((r, i) => `[${i + 1}] ${r.title} (${r.published_date ?? 'recent'}): ${r.content.slice(0, 400)}`).join('\n')
    const text = await gemini(
      `You check whether a tourist should visit "${name}" in ${city}, India on ${date}.\n` +
      `Use ONLY these search results; if they say nothing relevant, answer good with note "No recent notices".\n${snippets}\n` +
      `Reply as JSON {"verdict":"good"|"caution"|"avoid","note":"one sentence, cite [n]","use":[n,...]}`,
    ).catch(() => null)
    if (!text) return null
    try {
      const v = JSON.parse(text) as { verdict: LiveCheck['verdict']; note: string; use?: number[] }
      return { verdict: v.verdict, note: v.note, by: 'ai', sources: (v.use ?? []).map((n) => results[n - 1]).filter(Boolean).map((r) => ({ title: r.title, url: r.url })) }
    } catch { return null }
  })
}
