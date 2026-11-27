'use client'

import { useState } from 'react'
import { newId } from '@/lib/shared/id'
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2'

/**
 * Advanced mode only: sends raw HomeDSL straight to the VM
 * (`forwardedProps.dsl`), without the language model.
 */
export function DslInput({ disabled }: { disabled: boolean }) {
  const { agent } = useAgent()
  const { copilotkit } = useCopilotKit()
  const [dsl, setDsl] = useState('')

  const submit = () => {
    const source = dsl.trim()
    if (source === '' || disabled || agent.isRunning) return
    agent.addMessage({
      id: newId(),
      role: 'user',
      content: source,
    })
    setDsl('')
    void copilotkit.runAgent({ agent, forwardedProps: { dsl: source } })
  }

  return (
    <form
      className="mx-4 mb-4 flex gap-2 rounded-2xl border border-border p-2"
      onSubmit={e => {
        e.preventDefault()
        submit()
      }}
    >
      <textarea
        className="min-h-[38px] flex-1 resize-none bg-transparent font-mono text-xs text-success outline-none"
        placeholder={
          disabled
            ? 'Answer the question above to continue'
            : 'light[bedroom].power = on   (Ctrl+Enter to run)'
        }
        rows={2}
        value={dsl}
        disabled={disabled}
        onChange={e => setDsl(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <button
        type="submit"
        disabled={disabled}
        className="self-end rounded-full bg-foreground px-3 py-1 text-xs text-background disabled:opacity-50"
      >
        Run
      </button>
    </form>
  )
}
