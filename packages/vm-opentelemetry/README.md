# @opennest/vm-opentelemetry

Export VM execution traces as OpenTelemetry spans (Jaeger, Grafana Tempo, or any OTLP-compatible backend).

## Architecture

```
VMEvent (from @opennest/vm)
    │
    ▼
ExecutionEventNormalizer
    │
    ▼
ExecutionEvent (node.started | node.completed | node.attribute | node.event)
    │
    ▼
OpenTelemetryTraceSink
    │
    ▼
OpenTelemetry Spans → OTLP Exporter → Jaeger / Tempo
```

## Install

```bash
npm install @opennest/vm-opentelemetry @opennest/vm @opentelemetry/api
```

`@opennest/vm` is a peer dependency: your application provides it. `@opentelemetry/api` is a regular dependency of this package; install it too when your code imports it, as below. The usage example also needs `@opentelemetry/sdk-node` and `@opentelemetry/exporter-trace-otlp-http`.

## Usage

```ts
import { DefaultVMEventBus, executeCommand } from '@opennest/vm'
import { ExecutionEventNormalizer, OpenTelemetryTraceSink } from '@opennest/vm-opentelemetry'
import { trace } from '@opentelemetry/api'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const exporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
})

const sdk = new NodeSDK({ traceExporter: exporter })
sdk.start()

const eventBus = new DefaultVMEventBus()
const normalizer = new ExecutionEventNormalizer()
const sink = new OpenTelemetryTraceSink(trace.getTracer('opennest-vm'))

eventBus.subscribe(event => {
  for (const normalized of normalizer.consume(event)) {
    sink.consume(normalized)
  }
})

const result = await executeCommand(command, {
  devices,
  session,
  eventBus,
})

// Spans are automatically sent to Jaeger/Tempo via the OTLP exporter
```

## API

### `ExecutionEventNormalizer`

```ts
class ExecutionEventNormalizer {
  consume(event: VMEvent): ExecutionEvent[]
}
```

Transforms VM execution events (`program:begin`, `statement:begin`, etc.) into normalized trace events (`node.started`, `node.completed`, `node.attribute`, `node.event`).

### `OpenTelemetryTraceSink`

```ts
class OpenTelemetryTraceSink {
  constructor(tracer: Tracer)
  consume(event: ExecutionEvent): void
  getRootSpanContext(): SpanContext | undefined
  setContinuationLink(context: SpanContext): void
}
```

Creates and manages OpenTelemetry spans from normalized trace events. `getRootSpanContext()` returns the span context of the current root span; passing it to `setContinuationLink()` before a later run links that run's root span to the earlier one, so a run resumed after a user interaction can be followed as one flow (the playground does this).

### Event types

The normalized events are exported as types: `ExecutionEvent` is the union of `NodeStartedEvent`, `NodeCompletedEvent`, `NodeAttributeEvent` and `NodeLogEvent` (the `node.event` variant).

## Test

```bash
pnpm --filter @opennest/vm-opentelemetry run test
```
