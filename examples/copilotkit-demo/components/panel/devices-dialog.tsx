'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useDemoState } from '@/lib/client/use-demo-state'
import { useMode } from '../mode/mode-context'

function formatValue(value: unknown): string {
  if (value === true) return 'on'
  if (value === false) return 'off'
  if (value === null || value === undefined) return '—'
  return String(value)
}

/** Read-only view of the conversation's house. */
export function DevicesDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const state = useDemoState()
  const { mode } = useMode()
  const devices = state?.devices ?? []
  const rooms = [...new Set(devices.map(d => d.room))]

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[80vh] w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-card p-4 text-sm">
          <Dialog.Title className="mb-1 font-semibold">
            Devices in this house
          </Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted-foreground">
            Live state of the simulated devices for this conversation.
          </Dialog.Description>
          {devices.length === 0 && (
            <p className="text-xs text-muted-foreground">
              The house is created on the first message.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rooms.map(room => (
              <div key={room} className="rounded-lg border border-border p-2">
                <div className="mb-1 text-[10px] uppercase text-muted-foreground">
                  {room.replace(/_/g, ' ')}
                </div>
                {devices
                  .filter(d => d.room === room)
                  .map(d => (
                    <div key={d.id} className="mb-1 text-xs">
                      <span className="mr-1">{d.icon}</span>
                      <b>{mode === 'advanced' ? d.id : d.name}</b>
                      <div className="pl-5 text-muted-foreground">
                        {Object.entries(d.state)
                          .map(([k, v]) => `${k}: ${formatValue(v)}`)
                          .join(' · ') || 'no readable state'}
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>
          <Dialog.Close className="mt-3 rounded-md border border-border px-3 py-1 text-xs hover:bg-muted">
            Close
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
