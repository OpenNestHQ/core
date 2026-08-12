import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { DefaultVMEventBus } from '@opennest/vm'
import {
  ExecutionEventNormalizer,
  OpenTelemetryTraceSink,
} from '@opennest/vm-opentelemetry'
import type { VMEventBus } from '@opennest/vm'
import type { SpanContext } from '@opentelemetry/api'

export interface TelemetryHandle {
  eventBus: VMEventBus
  beginCycle(): void
  endCycle(continues: boolean): void
  shutdown: () => Promise<void>
}

export function initTelemetry(): TelemetryHandle | null {
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']
  if (!endpoint) return null

  const exporter = new OTLPTraceExporter({ url: endpoint })
  const provider = new BasicTracerProvider({
    resource: new Resource({
      'service.name': process.env['OTEL_SERVICE_NAME'] ?? 'opennest-playground',
    }),
  })
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
  provider.register()

  const tracer = trace.getTracer('opennest-playground')
  const eventBus = new DefaultVMEventBus()
  const normalizer = new ExecutionEventNormalizer()
  const sink = new OpenTelemetryTraceSink(tracer)

  eventBus.subscribe(event => {
    for (const norm of normalizer.consume(event)) {
      sink.consume(norm)
    }
  })

  let previousRoot: SpanContext | undefined

  return {
    eventBus,
    beginCycle() {
      if (previousRoot) {
        sink.setContinuationLink(previousRoot)
      }
    },
    endCycle(continues: boolean) {
      if (continues) {
        previousRoot = sink.getRootSpanContext()
      } else {
        previousRoot = undefined
      }
    },
    shutdown: async () => {
      await provider.shutdown()
    },
  }
}
