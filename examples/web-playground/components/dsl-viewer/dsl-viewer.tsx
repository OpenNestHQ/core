'use client'

import { useVM } from '@/hooks/use-vm'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Code2 } from 'lucide-react'

export function DSLViewer() {
  const { state } = useVM()

  return (
    <Card className="flex h-full flex-col border-border">
      <CardHeader className="py-2 px-3">
        <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Code2 className="h-3.5 w-3.5" />
          Programme DSL
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <pre className="h-full p-3 text-xs font-mono text-foreground whitespace-pre-wrap overflow-auto">
          {state.dslSource || '// Aucun programme'}
        </pre>
      </CardContent>
    </Card>
  )
}
