import type { VMEvent } from './events.js'
import type { ExecutionTracer } from './tracer.js'

export interface VMEventBus {
  emit(event: VMEvent): void
  subscribe(handler: (event: VMEvent) => void): () => void
}

export class DefaultVMEventBus implements VMEventBus {
  private listeners = new Set<(event: VMEvent) => void>()
  readonly tracer: ExecutionTracer | null

  constructor(tracer?: ExecutionTracer) {
    this.tracer = tracer ?? null
    if (tracer) {
      this.listeners.add(event => tracer.consume(event))
    }
  }

  emit(event: VMEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  subscribe(handler: (event: VMEvent) => void): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }
}
