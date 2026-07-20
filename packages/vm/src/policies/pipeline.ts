import type { Device, Session } from "../types.js";
import type {
  ExecutionPolicy,
  PlannedAction,
  PolicyContext,
  PipelineOutcome,
} from "./types.js";
import type { VMEventBus } from "../trace/event-bus.js";

export interface PipelineEnvironment {
  session: Session;
  devices: Device[];
}

export async function runPolicyPipeline(
  action: PlannedAction,
  policies: readonly ExecutionPolicy[],
  env: PipelineEnvironment,
  eventBus?: VMEventBus,
): Promise<PipelineOutcome> {
  return evaluateFrom(action, policies, env, 0, eventBus);
}

async function evaluateFrom(
  action: PlannedAction,
  policies: readonly ExecutionPolicy[],
  env: PipelineEnvironment,
  startIndex: number,
  eventBus?: VMEventBus,
): Promise<PipelineOutcome> {
  let currentAction = action;

  for (let i = startIndex; i < policies.length; i++) {
    const policy = policies[i]!;
    const ctx: PolicyContext = {
      action: currentAction,
      session: env.session,
      devices: env.devices,
    };

    eventBus?.emit({
      kind: "policy:begin",
      timestamp: Date.now(),
      name: policy.name,
      actionKind: currentAction.kind,
      deviceId: currentAction.device.id,
    });

    const decision = await policy.evaluate(ctx);

    eventBus?.emit({
      kind: "policy:end",
      timestamp: Date.now(),
      status: mapDecisionStatus(decision),
      decision: decision.kind,
      ...(decision.kind === "block" && "reason" in decision
        ? { reason: (decision as { reason: string }).reason }
        : {}),
    });

    switch (decision.kind) {
      case "continue":
        break;

      case "block":
        return {
          kind: "blocked",
          policyName: policy.name,
          reason: decision.reason,
        };

      case "skip":
        return {
          kind: "skipped",
          ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
        };

      case "pause":
        return {
          kind: "paused",
          interaction: decision.interaction,
          ...(decision.context !== undefined
            ? { context: decision.context }
            : {}),
        };

      case "replace":
        currentAction = decision.action;
        break;

      case "expand": {
        const results = await Promise.all(
          decision.actions.map((expanded) =>
            evaluateFrom(expanded, policies, env, i + 1, eventBus),
          ),
        );

        const approved: PlannedAction[] = [];
        for (const result of results) {
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
    }
  }

  return { kind: "execute", actions: [currentAction] };
}

function mapDecisionStatus(
  decision: { kind: string },
): "success" | "failed" | "waiting" | "skipped" {
  switch (decision.kind) {
    case "continue":
    case "replace":
    case "expand":
      return "success";
    case "block":
      return "failed";
    case "skip":
      return "skipped";
    case "pause":
      return "waiting";
    default:
      return "success";
  }
}
