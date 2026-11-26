'use client'

import { useMode } from '../mode/mode-context'
import type { DisplayMode } from '../mode/mode-context'

const MODES: { value: DisplayMode; label: string }[] = [
  { value: 'basic', label: 'Basic' },
  { value: 'advanced', label: 'Advanced' },
]

export function Header() {
  const { mode, setMode } = useMode()
  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-2">
      <span className="text-sm font-semibold">OpenNest · live demo</span>
      <div
        role="radiogroup"
        aria-label="Display mode"
        className="inline-flex overflow-hidden rounded-full border border-border text-xs"
      >
        {MODES.map(m => (
          <button
            key={m.value}
            role="radio"
            aria-checked={mode === m.value}
            onClick={() => setMode(m.value)}
            className={
              mode === m.value
                ? 'bg-foreground px-3 py-1 text-background'
                : 'px-3 py-1 text-muted-foreground hover:text-foreground'
            }
          >
            {m.label}
          </button>
        ))}
      </div>
    </header>
  )
}
