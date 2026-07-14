import type { Device, Session } from "../types.js";
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
): Promise<PipelineOutcome> {
  return evaluateFrom(action, policies, env, 0);
}

async function evaluateFrom(
  action: PlannedAction,
  policies: readonly ExecutionPolicy[],
  env: PipelineEnvironment,
  startIndex: number,
): Promise<PipelineOutcome> {
  let currentAction = action;

  for (let i = startIndex; i < policies.length; i++) {
    const policy = policies[i]!;
    const ctx: PolicyContext = {
      action: currentAction,
      session: env.session,
      devices: env.devices,
    };
    const decision = await policy.evaluate(ctx);

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
            evaluateFrom(expanded, policies, env, i + 1),
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
