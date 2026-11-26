'use client'

import { useState } from 'react'
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2'
import type { ReactCustomMessageRenderer } from '@copilotkit/react-core/v2'
import type { SuggestionResponse, SuggestionSummary } from '@opennest/sdk'
import { useDemoState } from '@/lib/client/use-demo-state'
import { useMode } from '../mode/mode-context'

type RenderProps = Parameters<
  Extract<
    NonNullable<ReactCustomMessageRenderer['render']>,
    (p: never) => unknown
  >
>[0]

const chip =
  'rounded-full border border-border px-3 py-1 text-xs hover:border-foreground disabled:opacity-50'

/** Shows the open follow-up suggestions under the last assistant message. */
export function SuggestionsAfterMessage({ message, position }: RenderProps) {
  const { agent } = useAgent()
  const state = useDemoState()
  const last = agent.messages[agent.messages.length - 1]
  if (
    position !== 'after' ||
    message.role !== 'assistant' ||
    last?.id !== message.id ||
    agent.isRunning ||
    state === null ||
    state.pending !== null ||
    state.suggestions.length === 0
  ) {
    return null
  }
  return (
    <>
      {state.suggestions.map(s => (
        <SuggestionCard key={s.id} suggestion={s} />
      ))}
    </>
  )
}

function SuggestionCard({ suggestion }: { suggestion: SuggestionSummary }) {
  const { agent } = useAgent()
  const { copilotkit } = useCopilotKit()
  const { mode } = useMode()
  const [sending, setSending] = useState(false)
  const [value, setValue] = useState('')
  const { question } = suggestion

  const send = (forwardedProps: Record<string, unknown>) => {
    setSending(true)
    void copilotkit
      .runAgent({ agent, forwardedProps })
      .finally(() => setSending(false))
  }
  const answer = (response: SuggestionResponse) =>
    send({ answerSuggestion: { suggestionId: suggestion.id, response } })
  const dismiss = () =>
    send({ dismissSuggestion: { suggestionId: suggestion.id } })

  return (
    <div className="my-2 rounded-xl border border-dashed border-muted-foreground/60 px-3 py-2 text-sm">
      <b>💡 {question.message}</b>
      {mode === 'advanced' && (
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          suggestion · {question.type}
        </span>
      )}
      {mode === 'advanced' && suggestion.targets.length > 0 && (
        <div className="font-mono text-[10px] text-muted-foreground">
          targets: {suggestion.targets.map(t => t.id).join(', ')}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {question.type === 'choice' ? (
          question.options.map(o => (
            <button
              key={o.value}
              className={chip}
              disabled={sending}
              onClick={() => answer({ type: 'choice', value: o.value })}
            >
              {o.label}
            </button>
          ))
        ) : (
          <form
            className="flex gap-1.5"
            onSubmit={e => {
              e.preventDefault()
              answer(
                question.type === 'number_input'
                  ? { type: 'number_input', value: Number(value) }
                  : { type: 'text_input', text: value },
              )
            }}
          >
            <input
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              type={question.type === 'number_input' ? 'number' : 'text'}
              value={value}
              onChange={e => setValue(e.target.value)}
            />
            <button className={chip} disabled={sending} type="submit">
              Send
            </button>
          </form>
        )}
        <button
          className={`${chip} text-muted-foreground`}
          disabled={sending}
          onClick={dismiss}
        >
          No thanks
        </button>
      </div>
    </div>
  )
}

export const suggestionRenderer: ReactCustomMessageRenderer = {
  render: SuggestionsAfterMessage,
}
