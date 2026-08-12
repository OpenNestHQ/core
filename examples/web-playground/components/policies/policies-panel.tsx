'use client'

import { useVM } from '@/hooks/use-vm'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Shield, Check } from 'lucide-react'

export function PoliciesPanel() {
  const { state } = useVM()

  return (
    <Card className="flex h-full flex-col border-border">
      <CardHeader className="py-2 px-3">
        <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Shield className="h-3.5 w-3.5" />
          Policies
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full">
          <div className="flex flex-col">
            {state.policies.map(policy => (
              <div
                key={policy.name}
                className="flex flex-col gap-1 px-3 py-2 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-green-400" />
                  <span className="text-xs font-medium text-foreground">
                    {policy.name}
                  </span>
                  <Badge variant="success" className="ml-auto">
                    ACTIVE
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {policy.description}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
