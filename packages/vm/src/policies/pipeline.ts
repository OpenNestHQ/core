import type { Device, Session } from "../types.js";
import type { ExecutionTracer } from "../trace/types.js";
import { NodeKind } from "../trace/types.js";
import type {
  ExecutionPolicy,
  PlannedAction,
  PolicyContext,
  PipelineOutcome,
} from "./types.js";

export interface PipelineEnvironment {
  session: Session;
  devices: Device[];
}

export async function runPolicyPipeline(
  action: PlannedAction,
  policies: readonly ExecutionPolicy[],
  env: PipelineEnvironment,
  tracer?: ExecutionTracer,
): Promise<PipelineOutcome> {
  return evaluateFrom(action, policies, env, 0, tracer);
}

async function evaluateFrom(
  action: PlannedAction,
  policies: readonly ExecutionPolicy[],
  env: PipelineEnvironment,
  startIndex: number,
  tracer?: ExecutionTracer,
): Promise<PipelineOutcome> {
  let currentAction = action;

  for (let i = startIndex; i < policies.length; i++) {
    const policy = policies[i]!;
    const ctx: PolicyContext = {
      action: currentAction,
      session: env.session,
      devices: env.devices,
    };

    tracer?.beginNode(NodeKind.Policy, `policy:${policy.name}`);
    tracer?.attribute("actionKind", currentAction.kind);
    tracer?.attribute("deviceId", currentAction.device.id);

    const decision = await policy.evaluate(ctx);
    tracer?.attribute("decision", decision.kind);

    switch (decision.kind) {
      case "continue":
        tracer?.endSuccess();
        break;

      case "block":
        tracer?.attribute("reason", decision.reason);
        tracer?.endFailed(`Blocked: ${decision.reason}`);
        return {
          kind: "blocked",
          policyName: policy.name,
          reason: decision.reason,
        };

      case "skip":
        tracer?.endSuccess();
        return {
          kind: "skipped",
          ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
        };

      case "pause":
        tracer?.endWaiting();
        return {
          kind: "paused",
          interaction: decision.interaction,
          ...(decision.context !== undefined
            ? { context: decision.context }
            : {}),
        };

      case "replace":
        tracer?.endSuccess();
        currentAction = decision.action;
        break;

      case "expand": {
        tracer?.endSuccess();
        const results = await Promise.all(
          decision.actions.map((expanded) =>
            evaluateFrom(expanded, policies, env, i + 1, tracer),
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
