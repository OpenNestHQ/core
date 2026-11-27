'use client'

import { useSyncExternalStore } from 'react'

/** Matches Tailwind's `md` breakpoint: below 768 px is a phone layout. */
const QUERY = '(max-width: 767px)'

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** `true` on a phone-sized viewport. Always `false` on the server. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
