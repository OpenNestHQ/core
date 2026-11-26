'use client'

import { useState } from 'react'
import { useInterrupt } from '@copilotkit/react-core/v2'
import type { InterruptRenderProps } from '@copilotkit/react-core/v2'
import type { UserInteraction } from '@opennest/sdk'
import { REASONS } from '@/lib/shared/interrupts'
import type { InterruptMetadata, ResumePayload } from '@/lib/shared/interrupts'
import { useMode } from '../mode/mode-context'

const KNOWN_REASONS = new Set<string>(Object.values(REASONS))

const chip =
  'rounded-full border border-border px-3 py-1 text-xs hover:border-foreground disabled:opacity-50'
const field =
  'rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-foreground'

/** Renders every VM question (AG-UI interrupt) as a card in the chat. */
export function VmInterrupts() {
  useInterrupt({
    render: props => <QuestionCard {...props} />,
  })
  return null
}

function QuestionCard({ interrupt, resolve, cancel }: InterruptRenderProps) {
  const { mode } = useMode()
  const [sending, setSending] = useState(false)
  if (interrupt === null) return <></>

  const metadata = interrupt.metadata as unknown as
    Partial<InterruptMetadata> | undefined
  const interaction = metadata?.interaction
  const answer = (payload: ResumePayload) => {
    setSending(true)
    void resolve(payload).finally(() => setSending(false))
  }

  // Unknown reason: AG-UI says render from the message, never fail.
  if (!KNOWN_REASONS.has(interrupt.reason) || interaction === undefined) {
    return (
      <Card title={interrupt.message ?? 'The agent needs your input.'}>
        <button className={chip} onClick={() => void cancel()}>
          Cancel
        </button>
      </Card>
    )
  }

  return (
    <Card
      title={interaction.message}
      {...(mode === 'advanced'
        ? { pill: interaction.type, status: 'status: awaiting_interaction' }
        : {})}
      {...(metadata?.error !== undefined ? { error: metadata.error } : {})}
      onCancel={() => void cancel()}
    >
      <Answers
        interaction={interaction}
        advanced={mode === 'advanced'}
        disabled={sending}
        onAnswer={answer}
      />
    </Card>
  )
}

function Card({
  title,
  pill,
  status,
  error,
  onCancel,
  children,
}: {
  title: string
  pill?: string
  status?: string
  error?: string
  onCancel?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="my-2 rounded-xl border border-warning/70 bg-warning/5 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <b>
          {title}
          {pill !== undefined && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal">
              {pill}
            </span>
          )}
        </b>
        {onCancel !== undefined && (
          <button
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>
      {error !== undefined && (
        <p className="mt-1.5 text-xs text-destructive">{error}</p>
      )}
      {status !== undefined && (
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  )
}

function Answers({
  interaction,
  advanced,
  disabled,
  onAnswer,
}: {
  interaction: UserInteraction
  advanced: boolean
  disabled: boolean
  onAnswer: (payload: ResumePayload) => void
}) {
  switch (interaction.type) {
    case 'device_selection':
      return (
        <>
          {interaction.devices.map(d => (
            <button
              key={d.id}
              className={chip}
              disabled={disabled}
              onClick={() => onAnswer({ deviceId: d.id })}
            >
              {advanced ? d.id : d.name}
            </button>
          ))}
        </>
      )
    case 'confirmation':
      return (
        <>
          <button
            className={`${chip} bg-foreground text-background`}
            disabled={disabled}
            onClick={() => onAnswer({ approved: true })}
          >
            Yes
          </button>
          <button
            className={chip}
            disabled={disabled}
            onClick={() => onAnswer({ approved: false })}
          >
            No
          </button>
        </>
      )
    case 'choice':
      return (
        <>
          {interaction.options.map(o => (
            <button
              key={o.value}
              className={chip}
              disabled={disabled}
              onClick={() => onAnswer({ value: o.value })}
            >
              {advanced ? `${o.label} (${o.value})` : o.label}
            </button>
          ))}
        </>
      )
    case 'text_input':
      return (
        <ValueForm
          disabled={disabled}
          placeholder={interaction.placeholder ?? ''}
          onSubmit={value => onAnswer({ value })}
        />
      )
    case 'number_input':
      return (
        <ValueForm
          disabled={disabled}
          type="number"
          placeholder={rangeLabel(interaction.min, interaction.max)}
          {...(interaction.min !== undefined ? { min: interaction.min } : {})}
          {...(interaction.max !== undefined ? { max: interaction.max } : {})}
          onSubmit={value => onAnswer({ value: Number(value) })}
        />
      )
    case 'action_parameter':
      return (
        <ParametersForm
          interaction={interaction}
          disabled={disabled}
          onSubmit={values => onAnswer({ values })}
        />
      )
  }
}

function rangeLabel(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `${min}–${max}`
  if (min !== undefined) return `≥ ${min}`
  if (max !== undefined) return `≤ ${max}`
  return 'number'
}

function ValueForm({
  disabled,
  placeholder,
  type = 'text',
  min,
  max,
  onSubmit,
}: {
  disabled: boolean
  placeholder: string
  type?: 'text' | 'number'
  min?: number
  max?: number
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <form
      className="flex gap-1.5"
      onSubmit={e => {
        e.preventDefault()
        // Empty answers go to the server too: it re-asks with an error.
        onSubmit(value)
      }}
    >
      <input
        autoFocus
        className={field}
        type={type}
        min={min}
        max={max}
        placeholder={placeholder}
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      <button className={chip} disabled={disabled} type="submit">
        Send
      </button>
    </form>
  )
}

function ParametersForm({
  interaction,
  disabled,
  onSubmit,
}: {
  interaction: Extract<UserInteraction, { type: 'action_parameter' }>
  disabled: boolean
  onSubmit: (values: Record<string, string | number>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  return (
    <form
      className="flex flex-wrap items-end gap-1.5"
      onSubmit={e => {
        e.preventDefault()
        const out: Record<string, string | number> = {}
        for (const p of interaction.missing) {
          const raw = values[p.name] ?? ''
          out[p.name] = p.type === 'number' && raw !== '' ? Number(raw) : raw
        }
        onSubmit(out)
      }}
    >
      {interaction.missing.map(p => (
        <label key={p.name} className="flex flex-col gap-0.5 text-[11px]">
          {p.name}
          {p.values !== undefined ? (
            <select
              className={field}
              value={values[p.name] ?? ''}
              onChange={e => setValues({ ...values, [p.name]: e.target.value })}
            >
              <option value="" disabled>
                pick…
              </option>
              {p.values.map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={field}
              type={p.type === 'number' ? 'number' : 'text'}
              value={values[p.name] ?? ''}
              onChange={e => setValues({ ...values, [p.name]: e.target.value })}
            />
          )}
        </label>
      ))}
      <button className={chip} disabled={disabled} type="submit">
        Send
      </button>
    </form>
  )
}
