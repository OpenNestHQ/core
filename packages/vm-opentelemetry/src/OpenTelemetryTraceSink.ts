import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import type { Attributes, Span, Tracer } from "@opentelemetry/api";
import type { ExecutionEvent } from "./events.js";

export class OpenTelemetryTraceSink {
  private spans = new Map<string, Span>();
  private tracer: Tracer;

  constructor(tracer: Tracer) {
    this.tracer = tracer;
  }

  consume(event: ExecutionEvent): void {
    switch (event.type) {
      case "node.started": {
        const parentSpan = event.parentNodeId
          ? this.spans.get(event.parentNodeId)
          : undefined;

        const parentCtx = parentSpan
          ? trace.setSpan(context.active(), parentSpan)
          : undefined;

        const span = this.tracer.startSpan(
          event.name,
          {
            attributes: {
              "node.kind": event.kind,
              ...event.attributes,
            } as Attributes,
          },
          parentCtx,
        );

        this.spans.set(event.nodeId, span);
        break;
      }

      case "node.completed": {
        const span = this.spans.get(event.nodeId);
        if (!span) return;

        if (event.attributes) {
          for (const [key, value] of Object.entries(event.attributes)) {
            span.setAttribute(key, value as Parameters<Span["setAttribute"]>[1]);
          }
        }

        switch (event.status) {
          case "success":
            span.setStatus({ code: SpanStatusCode.OK });
            break;
          case "failed":
            span.setStatus({ code: SpanStatusCode.ERROR });
            break;
          case "cancelled":
            span.setStatus({ code: SpanStatusCode.UNSET });
            break;
        }

        span.end(event.timestamp);
        this.spans.delete(event.nodeId);
        break;
      }

      case "node.attribute": {
        const span = this.spans.get(event.nodeId);
        if (!span) return;
        span.setAttribute(event.key, event.value as Parameters<Span["setAttribute"]>[1]);
        break;
      }

      case "node.event": {
        const span = this.spans.get(event.nodeId);
        if (!span) return;
        span.addEvent(
          event.name,
          event.attributes as Attributes,
        );
        break;
      }
    }
  }
}
