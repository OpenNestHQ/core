'use client'

import { useVM } from '@/hooks/use-vm'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MessageSquareWarning } from 'lucide-react'

export function InteractionPanel() {
  const { state, respondToInteraction } = useVM()
  const { interaction } = state

  if (!interaction) {
    return (
      <Card className="flex h-full flex-col border-border">
        <CardHeader className="py-2 px-3">
          <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <MessageSquareWarning className="h-3.5 w-3.5" />
            Interactions
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          Aucune interaction en attente
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="flex h-full flex-col border-border border-accent/50">
      <CardHeader className="py-2 px-3">
        <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <MessageSquareWarning className="h-3.5 w-3.5" />
          Interaction requise
          <Badge variant="warning" className="ml-auto">
            {interaction.type}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-3">
        {interaction.type === 'device_selection' && (
          <DeviceSelection
            interaction={interaction}
            onSelect={deviceId =>
              respondToInteraction({
                interactionId: interaction.id,
                type: 'device_selection',
                deviceId,
              })
            }
          />
        )}
        {interaction.type === 'confirmation' && (
          <ConfirmationView
            interaction={interaction}
            onConfirm={() =>
              respondToInteraction({
                interactionId: interaction.id,
                type: 'confirmation',
                confirmed: true,
              })
            }
            onDeny={() =>
              respondToInteraction({
                interactionId: interaction.id,
                type: 'confirmation',
                confirmed: false,
              })
            }
          />
        )}
        {interaction.type !== 'device_selection' &&
          interaction.type !== 'confirmation' && (
            <div className="text-xs text-muted-foreground">
              Type d&apos;interaction non supporté : {interaction.type}
            </div>
          )}
      </CardContent>
    </Card>
  )
}

function DeviceSelection({
  interaction,
  onSelect,
}: {
  interaction: {
    id: string
    type: 'device_selection'
    message: string
    devices: { id: string; name: string; type: string; room: string }[]
  }
  onSelect: (deviceId: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-foreground">{interaction.message}</p>
      <div className="flex flex-col gap-1">
        {interaction.devices.map((device, idx) => (
          <Button
            key={device.id}
            variant="outline"
            size="sm"
            onClick={() => onSelect(device.id)}
            className="justify-start h-auto py-2 text-xs"
          >
            <span className="font-mono text-muted-foreground mr-2">
              [{idx + 1}]
            </span>
            <span className="font-medium">{device.name}</span>
            <span className="ml-auto text-muted-foreground">
              {device.type} · {device.room}
            </span>
          </Button>
        ))}
      </div>
    </div>
  )
}

function ConfirmationView({
  interaction,
  onConfirm,
  onDeny,
}: {
  interaction: { id: string; type: 'confirmation'; message: string }
  onConfirm: () => void
  onDeny: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-foreground">{interaction.message}</p>
      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={onConfirm}
          className="flex-1 text-xs"
        >
          Confirmer
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onDeny}
          className="flex-1 text-xs"
        >
          Annuler
        </Button>
      </div>
    </div>
  )
}
