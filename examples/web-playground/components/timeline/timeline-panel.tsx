'use client'

import { useVM } from '@/hooks/use-vm'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ListChecks, Check, X, Minus } from 'lucide-react'

export function TimelinePanel() {
  const { state } = useVM()
  const { timeline } = state

  return (
    <Card className="flex h-full flex-col border-border">
      <CardHeader className="flex flex-row items-center justify-between py-2 px-3">
        <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" />
          Actions exécutées
        </CardTitle>
        <Badge variant="default">{timeline.length}</Badge>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full">
          {timeline.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground p-4">
              Aucune action exécutée
            </div>
          ) : (
            <div className="flex flex-col">
              {timeline.map(entry => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 px-3 py-2 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <div className="mt-0.5">
                    {entry.status === 'success' ? (
                      <Check className="h-3.5 w-3.5 text-green-400" />
                    ) : entry.status === 'failed' ? (
                      <X className="h-3.5 w-3.5 text-red-400" />
                    ) : (
                      <Minus className="h-3.5 w-3.5 text-yellow-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground truncate">
                        {entry.action}
                      </span>
                      <Badge
                        variant={
                          entry.status === 'success'
                            ? 'success'
                            : entry.status === 'failed'
                              ? 'destructive'
                              : 'warning'
                        }
                      >
                        {entry.status}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {entry.deviceName} · {entry.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
