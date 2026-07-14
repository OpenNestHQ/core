import type { ExecutionPolicy, PolicyContext, PolicyDecision } from "./types.js";

export class NoopExecutionPolicy implements ExecutionPolicy {
  readonly name = "noop";

  evaluate(_ctx: PolicyContext): PolicyDecision {
    return { kind: "continue" };
  }
}
