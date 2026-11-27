'use client'

import type { ReactActivityMessageRenderer } from '@copilotkit/react-core/v2'
import { ANSWER_ACTIVITY, answerTraceSchema } from '@/lib/shared/answer-trace'
import type { AnswerTrace } from '@/lib/shared/answer-trace'
import { useMode } from '../mode/mode-context'

const MARK: Record<AnswerTrace['status'], string> = {
  answered: '✓',
  cancelled: '✕',
  dismissed: '–',
}

/** One answered question or suggestion, left in the chat as a compact line. */
function AnswerTraceLine({ content }: { content: AnswerTrace }) {
  const { mode } = useMode()
  const answered = content.status === 'answered'
  return (
    <div className="my-1 flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
      <span className={answered ? 'text-success' : ''}>
        {MARK[content.status]}
      </span>
      {content.kind === 'suggestion' && <span>💡</span>}
      <span>{content.question}</span>
      <span>→</span>
      <b className={answered ? 'text-foreground' : ''}>{content.answer}</b>
      {mode === 'advanced' && (
        <span className="font-mono text-[10px]">
          {content.kind === 'suggestion'
            ? `suggestion · ${content.type}`
            : content.type}
          {content.detail !== undefined && ` · ${content.detail}`}
        </span>
      )}
    </div>
  )
}

export const answerTraceRenderer: ReactActivityMessageRenderer<AnswerTrace> = {
  activityType: ANSWER_ACTIVITY,
  content: answerTraceSchema,
  render: AnswerTraceLine,
}
