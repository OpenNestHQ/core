'use client'

import { useState, useRef, useEffect, type FormEvent } from 'react'
import { useVM } from '@/hooks/use-vm'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Send, Terminal, Play, RotateCcw, XCircle } from 'lucide-react'

export function ChatPanel() {
  const { state, executeDSL, cancelExecution, resetAll, runDemo } = useVM()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [state.messages])

  const handleSend = (e?: FormEvent) => {
    e?.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) return
    setInput('')
    executeDSL(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const isBusy = state.status === 'running'
  const isAwaiting = state.status === 'awaiting_interaction'

  return (
    <Card className="flex h-full flex-col border-border">
      <CardHeader className="flex flex-row items-center justify-between py-2 px-3">
        <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" />
          Conversation
        </CardTitle>
        <div className="flex items-center gap-1">
          <Badge
            variant={
              state.status === 'idle'
                ? 'default'
                : state.status === 'error'
                  ? 'destructive'
                  : state.status === 'awaiting_interaction'
                    ? 'warning'
                    : 'success'
            }
          >
            {state.status.replace('_', ' ')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full" ref={scrollRef}>
          <div className="flex flex-col gap-2 p-3">
            {state.messages.map(msg => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === 'user'
                    ? 'items-end'
                    : msg.role === 'system'
                      ? 'items-center'
                      : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-accent text-accent-foreground'
                      : msg.role === 'system'
                        ? 'bg-muted/50 text-muted-foreground italic text-center'
                        : 'bg-muted text-foreground'
                  }`}
                >
                  {msg.role === 'user' && msg.dsl && (
                    <div className="mb-1 font-mono text-[11px] opacity-70">
                      {msg.dsl}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
      <div className="border-t border-border p-3">
        <form onSubmit={e => handleSend(e)} className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy || isAwaiting}
            rows={2}
            placeholder={
              isAwaiting
                ? "Répondez à l'interaction ci-dessous..."
                : 'light[salon].power = on'
            }
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 font-mono"
          />
          <Button
            type="submit"
            size="sm"
            disabled={isBusy || isAwaiting || !input.trim()}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </form>
        <div className="mt-2 flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={runDemo}
            disabled={isBusy || isAwaiting}
            className="flex-1 text-xs h-7"
          >
            <Play className="h-3 w-3" />
            Demo
          </Button>
          {isAwaiting && (
            <Button
              variant="destructive"
              size="sm"
              onClick={cancelExecution}
              className="flex-1 text-xs h-7"
            >
              <XCircle className="h-3 w-3" />
              Cancel
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAll}
            disabled={isBusy}
            className="text-xs h-7"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </Card>
  )
}
