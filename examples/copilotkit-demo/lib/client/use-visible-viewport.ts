'use client'

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

/**
 * Pins the app to the part of the screen the user can see. When a phone's
 * virtual keyboard opens, the browser shrinks and scrolls the visual
 * viewport; following it keeps the chat input right above the keyboard.
 * `undefined` when disabled (desktop) or unsupported.
 */
export function useVisibleViewport(
  enabled: boolean,
): CSSProperties | undefined {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!enabled || viewport === null) {
      setBox(null)
      return
    }
    const update = () =>
      setBox({ top: viewport.offsetTop, height: viewport.height })
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [enabled])

  return box === null
    ? undefined
    : { position: 'fixed', left: 0, right: 0, top: box.top, height: box.height }
}
