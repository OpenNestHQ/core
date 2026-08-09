import type { Device, Session } from "../types.js";
import type {
  Middleware,
  PlannedAction,
  PipelineOutcome,
} from "./types.js";
import {
  BlockSignal,
  SkipSignal,
  PauseSignal,
  ExpandSignal,
} from "./types.js";
import type { VMEventBus } from "../trace/event-bus.js";

export interface PipelineEnvironment {
  session: Session;
  devices: Device[];
}

export async function runMiddlewarePipeline(
  action: PlannedAction,
  middlewares: readonly Middleware[],
  env: PipelineEnvironment,
  eventBus?: VMEventBus,
): Promise<PipelineOutcome> {
  return evaluateAt(action, middlewares, env, 0, eventBus);
}

async function evaluateAt(
  action: PlannedAction,
  middlewares: readonly Middleware[],
  env: PipelineEnvironment,
  index: number,
  eventBus?: VMEventBus,
): Promise<PipelineOutcome> {
  if (index >= middlewares.length) {
    return { kind: "execute", actions: [action] };
  }

  const middleware = middlewares[index]!;
  const ctx = { action, session: env.session, devices: env.devices };

  eventBus?.emit({
    kind: "middleware:begin",
    timestamp: Date.now(),
    name: getMiddlewareName(middleware),
    actionKind: action.kind,
    deviceId: action.device.id,
  });

  const next = async (): Promise<PipelineOutcome> => {
    return evaluateAt(ctx.action, middlewares, env, index + 1, eventBus);
  };

  try {
    const outcome = await middleware(ctx, next);
    eventBus?.emit({
      kind: "middleware:end",
      timestamp: Date.now(),
      status: mapOutcomeStatus(outcome),
      decision: outcome.kind,
      ...("reason" in outcome && (outcome as { reason?: string }).reason !== undefined
        ? { reason: (outcome as { reason: string }).reason }
        : {}),
    });
    return outcome;
  } catch (signal) {
    if (signal instanceof BlockSignal) {
      eventBus?.emit({
        kind: "middleware:end",
        timestamp: Date.now(),
        status: "failed",
        decision: "block",
        reason: signal.reason,
      });
      return {
        kind: "blocked",
        policyName: getMiddlewareName(middleware),
        reason: signal.reason,
      };
    }

    if (signal instanceof SkipSignal) {
      eventBus?.emit({
        kind: "middleware:end",
        timestamp: Date.now(),
        status: "skipped",
        decision: "skip",
        ...(signal.reason !== undefined ? { reason: signal.reason } : {}),
      });
      return {
        kind: "skipped",
        ...(signal.reason !== undefined ? { reason: signal.reason } : {}),
      };
    }

    if (signal instanceof PauseSignal) {
      eventBus?.emit({
        kind: "middleware:end",
        timestamp: Date.now(),
        status: "waiting",
        decision: "pause",
      });
      return {
        kind: "paused",
        interaction: signal.interaction,
        ...(signal.context !== undefined ? { context: signal.context } : {}),
      };
    }

    if (signal instanceof ExpandSignal) {
      eventBus?.emit({
        kind: "middleware:end",
        timestamp: Date.now(),
        status: "success",
        decision: "expand",
      });

      const approved: PlannedAction[] = [];
      for (const expanded of signal.actions) {
        const result = await evaluateAt(
          expanded,
          middlewares,
          env,
          index + 1,
          eventBus,
        );

        if (result.kind === "execute") {
          approved.push(...result.actions);
        } else if (result.kind === "skipped") {
          continue;
        } else {
          return result;
        }
      }

      return { kind: "execute", actions: approved };
    }

    throw signal;
  }
}

function getMiddlewareName(mw: Middleware): string {
  if ("name" in mw && typeof (mw as { name: unknown }).name === "string") {
    return (mw as { name: string }).name;
  }
  return "anonymous";
}

function mapOutcomeStatus(
  outcome: PipelineOutcome,
): "success" | "failed" | "waiting" | "skipped" {
  switch (outcome.kind) {
    case "execute":
      return "success";
    case "blocked":
      return "failed";
    case "skipped":
      return "skipped";
    case "paused":
      return "waiting";
  }
}
