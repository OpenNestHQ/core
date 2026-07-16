import type {
  ExecutionPolicy,
  PolicyContext,
  PolicyDecision,
  PlannedAction,
} from "./types.js";

let nextId = 0;

function generateId(): string {
  return `confirm_${++nextId}`;
}

function defaultMessage(action: PlannedAction): string {
  const device = action.device;
  const label = `${device.name} (${device.type} in ${device.room})`;

  switch (action.kind) {
    case "set_property":
      return `Set ${action.property} on ${label} to ${describeValue(action.value)}?`;
    case "increment_property":
      return `Increment ${action.property} on ${label} by ${describeValue(action.value)}?`;
    case "read_property":
      return `Read ${action.property} from ${label}?`;
    case "invoke_action":
      return `Execute ${action.method}() on ${label}?`;
  }
}

function describeValue(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  const v = value as { kind?: string; value?: unknown };
  if (v.kind === "power") return v.value as string;
  if (v.kind === "number") return String(v.value);
  if (v.kind === "string") return `"${v.value as string}"`;
  return String(v.value ?? value);
}

function propertyOrMethod(action: PlannedAction): string {
  switch (action.kind) {
    case "set_property":
    case "read_property":
    case "increment_property":
      return action.property;
    case "invoke_action":
      return action.method;
  }
}

export class ConfirmationPolicy implements ExecutionPolicy {
  readonly name = "confirmation";

  private readonly requireConfirmation: (action: PlannedAction) => boolean;
  private readonly formatMessage: (action: PlannedAction) => string;
  private readonly decisions = new Map<string, { approved: boolean }>();

  constructor(config: {
    requireConfirmation: (action: PlannedAction) => boolean;
    message?: (action: PlannedAction) => string;
  }) {
    this.requireConfirmation = config.requireConfirmation;
    this.formatMessage = config.message ?? defaultMessage;
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    if (!this.requireConfirmation(ctx.action)) {
      return { kind: "continue" };
    }

    const fp = this.fingerprint(ctx.action);
    const prior = this.decisions.get(fp);

    if (prior !== undefined) {
      if (prior.approved) {
        return { kind: "continue" };
      }
      return {
        kind: "block",
        reason: "Action denied by user",
      };
    }

    return {
      kind: "pause",
      interaction: {
        id: generateId(),
        type: "confirmation",
        message: this.formatMessage(ctx.action),
      },
      context: { fingerprint: fp, policy: this },
    };
  }

  resolve(fingerprint: string, approved: boolean): void {
    this.decisions.set(fingerprint, { approved });
  }

  private fingerprint(action: PlannedAction): string {
    return `${action.device.id}::${action.kind}::${propertyOrMethod(action)}`;
  }
}
