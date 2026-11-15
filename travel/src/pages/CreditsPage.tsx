import { useEffect } from 'react'
import { PublicPage } from '../ui/PublicLayout'
import { PHOTOS, photoSrc, type PhotoId } from '../ui/photos'

/** /credits: every photograph Tripzy shows, with its author, licence and source (restored). */
export default function CreditsPage() {
  useEffect(() => { document.title = 'Photo credits · Tripzy' }, [])
  return (
    <PublicPage>
      <section className="mx-auto max-w-4xl px-5 py-20 md:px-10">
        <div className="tz-kicker">Credits</div>
        <h1 className="tz-h1 mt-4 text-content">The photographs</h1>
        <p className="tz-lede mt-5 max-w-2xl">Every image on Tripzy's public pages comes from Wikimedia Commons under an open licence. Thank you to the photographers. Place photos inside the app are loaded from Wikipedia with the same attribution.</p>
        <ul className="mt-12 divide-y divide-edge border-y border-edge">
          {(Object.entries(PHOTOS) as [PhotoId, (typeof PHOTOS)[PhotoId]][]).map(([id, p]) => (
            <li key={id} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-5 py-5">
              <img src={photoSrc(id, true)} alt={p.place} loading="lazy" className="aspect-[4/3] w-24 rounded-xl object-cover" />
              <div className="min-w-0">
                <div className="font-serif text-[22px] leading-tight text-content">{p.place}</div>
                <div className="mt-1 text-[14px] text-content-muted">{p.author} · {p.license} · <a href={p.source} target="_blank" rel="noreferrer" className="text-accent-on underline underline-offset-2">source</a></div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </PublicPage>
  )
}
