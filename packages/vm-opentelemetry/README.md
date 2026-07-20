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

## Usage

```ts
import { DefaultVMEventBus } from "@opennest/vm";
import { ExecutionEventNormalizer, OpenTelemetryTraceSink } from "@opennest/vm-opentelemetry";
import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const exporter = new OTLPTraceExporter({
  url: "http://localhost:4318/v1/traces",
});

const sdk = new NodeSDK({ traceExporter: exporter });
sdk.start();

const eventBus = new DefaultVMEventBus();
const normalizer = new ExecutionEventNormalizer();
const sink = new OpenTelemetryTraceSink(trace.getTracer("opennest-vm"));

eventBus.subscribe((event) => {
  for (const normalized of normalizer.consume(event)) {
    sink.consume(normalized);
  }
});

const result = await executeCommand(command, {
  devices,
  session,
  eventBus,
});

// Spans are automatically sent to Jaeger/Tempo via the OTLP exporter
```

## API

### `ExecutionEventNormalizer`

```ts
class ExecutionEventNormalizer {
  consume(event: VMEvent): ExecutionEvent[];
}
```

Transforms VM execution events (`program:begin`, `statement:begin`, etc.) into normalized trace events (`node.started`, `node.completed`, `node.attribute`, `node.event`).

### `OpenTelemetryTraceSink`

```ts
class OpenTelemetryTraceSink {
  constructor(tracer: Tracer);
  consume(event: ExecutionEvent): void;
}
```

Creates and manages OpenTelemetry spans from normalized trace events.

## Test

```bash
pnpm --filter @opennest/vm-opentelemetry run test
```
