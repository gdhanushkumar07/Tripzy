/**
 * Tripzy motion system: one place that sets up GSAP + ScrollTrigger for the app.
 *
 * Scrolling: the platform shell locks <html> and scrolls <body> on desktop
 * (index.css). GSAP treats <body> as "the viewport" and reads window.scrollY,
 * which stays 0 in that mode, so nothing would ever trigger. Pages that use
 * scroll motion call useDocumentScroll(), which switches to ordinary document
 * scrolling while they are mounted (the same mode the shell already uses on
 * phones) and restores the shell's mode on unmount.
 *
 * prefers-reduced-motion: callers check prefersReducedMotion() and render the
 * final state. Every animation lives in a useGSAP scope, so it is reverted and
 * its ScrollTriggers killed when the component unmounts.
 */
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { useLayoutEffect, type RefObject } from 'react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

let docScrollUsers = 0

/** Use document scrolling while this page is mounted (see header comment). */
export function useDocumentScroll(): void {
  useLayoutEffect(() => {
    docScrollUsers += 1
    document.documentElement.classList.add('tz-doc')
    ScrollTrigger.refresh()
    // fonts and images change layout after first paint
    const t = window.setTimeout(() => ScrollTrigger.refresh(), 700)
    return () => {
      window.clearTimeout(t)
      docScrollUsers -= 1
      if (docScrollUsers === 0) document.documentElement.classList.remove('tz-doc')
    }
  }, [])
}

/** Scroll position helper that works in both of the shell's modes. */
export function scrollY(): number {
  return Math.max(window.scrollY, document.body.scrollTop)
}

/**
 * Reveal every `[data-reveal]` inside `scope` as it scrolls into view.
 * data-reveal="up" (default) | "fade" | "mask" (clip-path wipe for images).
 * Elements marked [data-reveal-stagger] reveal their direct children in sequence.
 */
export function useReveal(scope: RefObject<HTMLElement | null>, deps: unknown[] = []): void {
  useGSAP(() => {
    if (!scope.current || prefersReducedMotion()) return
    const els = gsap.utils.toArray<HTMLElement>('[data-reveal]', scope.current)
    els.forEach((el) => {
      const kind = el.dataset.reveal || 'up'
      const targets = el.hasAttribute('data-reveal-stagger') ? Array.from(el.children) : [el]
      const from: gsap.TweenVars =
        kind === 'mask' ? { clipPath: 'inset(12% 8% 12% 8% round 28px)', scale: 1.06 }
        : kind === 'fade' ? { opacity: 0 }
        : { opacity: 0, y: 36 }
      const to: gsap.TweenVars =
        kind === 'mask' ? { clipPath: 'inset(0% 0% 0% 0% round 0px)', scale: 1 }
        : { opacity: 1, y: 0 }
      gsap.fromTo(targets, from, {
        ...to,
        duration: kind === 'mask' ? 1.3 : 0.9,
        ease: 'power3.out',
        stagger: 0.09,
        ...(kind === 'mask' ? { clearProps: 'clipPath' } : {}),
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      })
    })
  }, { scope, dependencies: deps })
}

export { gsap, ScrollTrigger, useGSAP }
