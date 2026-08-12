import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SpanStatusCode } from '@opentelemetry/api'
import type { Tracer, Span, SpanContext } from '@opentelemetry/api'
import { OpenTelemetryTraceSink } from './OpenTelemetryTraceSink.js'

function makeSpanContext(): SpanContext {
  return {
    traceId: 'abc',
    spanId: 'def',
    traceFlags: 1,
  }
}

function makeSpan(): Span {
  return {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
    addEvent: vi.fn(),
    addLink: vi.fn(),
    spanContext: vi.fn(() => makeSpanContext()),
  } as unknown as Span
}

function makeTracer(spans: Span[]): Tracer {
  return {
    startSpan: vi.fn(() => {
      const span = makeSpan()
      spans.push(span)
      return span
    }),
  } as unknown as Tracer
}

describe('OpenTelemetryTraceSink', () => {
  let spans: Span[]
  let tracer: Tracer
  let sink: OpenTelemetryTraceSink

  beforeEach(() => {
    spans = []
    tracer = makeTracer(spans)
    sink = new OpenTelemetryTraceSink(tracer)
  })

  it('creates a span on node.started', () => {
    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Program',
      name: 'program',
      timestamp: 1000,
    })

    expect(tracer.startSpan).toHaveBeenCalledTimes(1)
    expect(tracer.startSpan).toHaveBeenCalledWith(
      'program',
      { attributes: { 'node.kind': 'Program' } },
      undefined,
    )
  })

  it('creates two spans with parent-child relationship', () => {
    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Program',
      name: 'program',
      timestamp: 1000,
    })

    sink.consume({
      type: 'node.started',
      nodeId: '2',
      parentNodeId: '1',
      kind: 'Statement',
      name: 'statement[0]',
      timestamp: 1010,
    })

    expect(tracer.startSpan).toHaveBeenCalledTimes(2)
    expect(spans).toHaveLength(2)
  })

  it('completes a span on node.completed with success', () => {
    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Program',
      name: 'program',
      timestamp: 1000,
    })

    sink.consume({
      type: 'node.completed',
      nodeId: '1',
      timestamp: 1100,
      status: 'success',
    })

    expect(spans[0]!.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.OK,
    })
    expect(spans[0]!.end).toHaveBeenCalledWith(1100)
  })

  it('completes a span on node.completed with failed status', () => {
    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Execute',
      name: 'execute:set_property',
      timestamp: 1000,
    })

    sink.consume({
      type: 'node.completed',
      nodeId: '1',
      timestamp: 1100,
      status: 'failed',
    })

    expect(spans[0]!.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
    })
  })

  it('handles cancelled status', () => {
    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Middleware',
      name: 'middleware:noop',
      timestamp: 1000,
    })

    sink.consume({
      type: 'node.completed',
      nodeId: '1',
      timestamp: 1100,
      status: 'cancelled',
    })

    expect(spans[0]!.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.UNSET,
    })
    expect(spans[0]!.end).toHaveBeenCalledWith(1100)
  })

  it('sets attributes on node.attribute', () => {
    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Execute',
      name: 'execute:set_property',
      timestamp: 1000,
    })

    sink.consume({
      type: 'node.attribute',
      nodeId: '1',
      key: 'deviceId',
      value: 'kitchen.light',
    })

    expect(spans[0]!.setAttribute).toHaveBeenCalledWith(
      'deviceId',
      'kitchen.light',
    )
  })

  it('sets attributes on completed event', () => {
    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Statement',
      name: 'statement[0]',
      timestamp: 1000,
    })

    sink.consume({
      type: 'node.completed',
      nodeId: '1',
      timestamp: 1100,
      status: 'success',
      attributes: {
        resolvedDeviceCount: 1,
        changeCount: 1,
      },
    })

    expect(spans[0]!.setAttribute).toHaveBeenCalledWith(
      'resolvedDeviceCount',
      1,
    )
    expect(spans[0]!.setAttribute).toHaveBeenCalledWith('changeCount', 1)
  })

  it('sets node.kind as span attribute on start', () => {
    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Middleware',
      name: 'middleware:confirmation',
      timestamp: 1000,
      attributes: { actionKind: 'turn_off' },
    })

    expect(tracer.startSpan).toHaveBeenCalledWith(
      'middleware:confirmation',
      {
        attributes: {
          'node.kind': 'Middleware',
          actionKind: 'turn_off',
        },
      },
      undefined,
    )
  })

  it('adds event on node.event', () => {
    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Statement',
      name: 'statement[0]',
      timestamp: 1000,
    })

    sink.consume({
      type: 'node.event',
      nodeId: '1',
      name: 'resolved',
      attributes: { deviceCount: 3 },
    })

    expect(spans[0]!.addEvent).toHaveBeenCalledWith('resolved', {
      deviceCount: 3,
    })
  })

  it('ignores events for unknown nodeIds', () => {
    sink.consume({
      type: 'node.completed',
      nodeId: '999',
      timestamp: 1000,
      status: 'success',
    })

    sink.consume({
      type: 'node.attribute',
      nodeId: '999',
      key: 'x',
      value: 1,
    })

    sink.consume({
      type: 'node.event',
      nodeId: '999',
      name: 'test',
    })

    expect(spans).toHaveLength(0)
  })

  it('full program → statement → execute lifecycle', () => {
    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Program',
      name: 'program',
      timestamp: 1000,
    })

    sink.consume({
      type: 'node.started',
      nodeId: '2',
      parentNodeId: '1',
      kind: 'Statement',
      name: 'statement[0]',
      timestamp: 1010,
    })
    sink.consume({
      type: 'node.attribute',
      nodeId: '2',
      key: 'statementKind',
      value: 'action',
    })

    sink.consume({
      type: 'node.started',
      nodeId: '3',
      parentNodeId: '2',
      kind: 'Execute',
      name: 'execute:set_property',
      timestamp: 1020,
    })
    sink.consume({
      type: 'node.attribute',
      nodeId: '3',
      key: 'deviceId',
      value: 'light.kitchen',
    })

    sink.consume({
      type: 'node.completed',
      nodeId: '3',
      timestamp: 1030,
      status: 'success',
    })

    sink.consume({
      type: 'node.completed',
      nodeId: '2',
      timestamp: 1040,
      status: 'success',
      attributes: { resolvedDeviceCount: 1 },
    })

    sink.consume({
      type: 'node.completed',
      nodeId: '1',
      timestamp: 1050,
      status: 'success',
    })

    expect(spans).toHaveLength(3)
    expect(spans[0]!.end).toHaveBeenCalled()
    expect(spans[1]!.end).toHaveBeenCalled()
    expect(spans[2]!.end).toHaveBeenCalled()
  })
})

describe('OpenTelemetryTraceSink span links', () => {
  it('getRootSpanContext returns undefined before any span', () => {
    const sink = new OpenTelemetryTraceSink(makeTracer([]))
    expect(sink.getRootSpanContext()).toBeUndefined()
  })

  it('getRootSpanContext returns span context after root span starts', () => {
    const spans: Span[] = []
    const sink = new OpenTelemetryTraceSink(makeTracer(spans))

    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Program',
      name: 'program',
      timestamp: 1000,
    })

    const ctx = sink.getRootSpanContext()
    expect(ctx).toBeDefined()
    expect(spans[0]!.spanContext).toHaveBeenCalled()
  })

  it('setContinuationLink adds link to next root span', () => {
    const spans: Span[] = []
    const sink = new OpenTelemetryTraceSink(makeTracer(spans))
    const linkCtx = makeSpanContext()

    sink.setContinuationLink(linkCtx)

    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Program',
      name: 'program',
      timestamp: 1000,
    })

    expect(spans[0]!.addLink).toHaveBeenCalledWith({
      context: linkCtx,
    })
  })

  it('continuation link is consumed only once', () => {
    const spans: Span[] = []
    const sink = new OpenTelemetryTraceSink(makeTracer(spans))
    const linkCtx = makeSpanContext()

    sink.setContinuationLink(linkCtx)

    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Program',
      name: 'program',
      timestamp: 1000,
    })
    sink.consume({
      type: 'node.completed',
      nodeId: '1',
      timestamp: 1100,
      status: 'success',
    })

    sink.consume({
      type: 'node.started',
      nodeId: '2',
      kind: 'Program',
      name: 'program',
      timestamp: 2000,
    })

    expect(spans[0]!.addLink).toHaveBeenCalledTimes(1)
    expect(spans[1]!.addLink).not.toHaveBeenCalled()
  })

  it('no link without setContinuationLink', () => {
    const spans: Span[] = []
    const sink = new OpenTelemetryTraceSink(makeTracer(spans))

    sink.consume({
      type: 'node.started',
      nodeId: '1',
      kind: 'Program',
      name: 'program',
      timestamp: 1000,
    })

    expect(spans[0]!.addLink).not.toHaveBeenCalled()
  })
})
