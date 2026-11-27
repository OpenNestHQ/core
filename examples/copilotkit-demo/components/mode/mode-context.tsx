'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useIsMobile } from '@/lib/client/use-is-mobile'

export type DisplayMode = 'basic' | 'advanced'

const STORAGE_KEY = 'opennest-demo-mode'

interface ModeValue {
  mode: DisplayMode
  setMode: (mode: DisplayMode) => void
}

const ModeContext = createContext<ModeValue | null>(null)

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<DisplayMode>('basic')

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'basic' || saved === 'advanced') setModeState(saved)
  }, [])

  const setMode = (next: DisplayMode) => {
    setModeState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }

  // A phone always shows Basic; the saved (desktop) choice is left untouched.
  const isMobile = useIsMobile()
  const effective: DisplayMode = isMobile ? 'basic' : mode

  return (
    <ModeContext.Provider value={{ mode: effective, setMode }}>
      {children}
    </ModeContext.Provider>
  )
}

export function useMode(): ModeValue {
  const value = useContext(ModeContext)
  if (value === null) throw new Error('useMode needs a ModeProvider')
  return value
}
