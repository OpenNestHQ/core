import type { Value, SimpleCondition } from "@opennest/lang-core";
import type { Device, StateChange } from "./types.js";
import type { PlannedAction } from "./policies/types.js";

export async function executePlannedAction(
  action: PlannedAction,
): Promise<StateChange> {
  switch (action.kind) {
    case "set_property":
      return executeAssignment(action.device, action.property, action.value);
    case "increment_property":
      return executeIncrement(action.device, action.property, action.value);
    case "read_property":
      return executeQuery(action.device, action.property);
    case "invoke_action":
      return executeAction(action.device, action.method);
  }
}

export async function executeAssignment(
  device: Device,
  property: string,
  value: Value,
): Promise<StateChange> {
  const oldValue = await device.driver.getProperty(
    device.id,
    property,
    device.driverConfig,
  );
  const newValue = extractValue(value);

  await device.driver.setProperty(
    device.id,
    property,
    newValue,
    device.driverConfig,
  );

  return {
    deviceId: device.id,
    property,
    oldValue,
    newValue,
  };
}

export async function executeIncrement(
  device: Device,
  property: string,
  value: Value,
): Promise<StateChange> {
  const currentValue = await device.driver.getProperty(
    device.id,
    property,
    device.driverConfig,
  );
  const increment = extractNumericValue(value);

  let newValue: unknown;
  if (typeof currentValue === "number") {
    newValue = currentValue + increment;
  } else {
    newValue = increment;
  }

  await device.driver.setProperty(
    device.id,
    property,
    newValue,
    device.driverConfig,
  );

  return {
    deviceId: device.id,
    property,
    oldValue: currentValue,
    newValue,
  };
}

export async function executeQuery(
  device: Device,
  property: string,
): Promise<StateChange> {
  const currentValue = await device.driver.getProperty(
    device.id,
    property,
    device.driverConfig,
  );

  return {
    deviceId: device.id,
    property,
    oldValue: currentValue,
    newValue: currentValue,
  };
}

export async function executeAction(
  device: Device,
  method: string,
): Promise<StateChange> {
  await device.driver.executeAction(
    device.id,
    method,
    device.driverConfig,
  );

  return {
    deviceId: device.id,
    property: `action:${method}`,
    oldValue: null,
    newValue: `called`,
  };
}

function extractValue(value: Value): unknown {
  switch (value.kind) {
    case "power":
      return value.value === "on";
    case "number":
      return value.value;
    case "string":
      return value.value;
    case "identifier":
      return value.value;
  }
}

function extractNumericValue(value: Value): number {
  switch (value.kind) {
    case "number":
      return value.value;
    case "power":
      return value.value === "on" ? 1 : 0;
    case "string": {
      const n = Number(value.value);
      return Number.isNaN(n) ? 0 : n;
    }
    case "identifier": {
      const n = Number(value.value);
      return Number.isNaN(n) ? 0 : n;
    }
  }
}

export function evaluateCondition(
  condition: SimpleCondition,
  actualValue: unknown,
): boolean {
  const expected = extractValue(condition.value);

  let normalized = actualValue;
  if (typeof actualValue === "boolean") {
    if (expected === "on") normalized = true;
    if (expected === "off") normalized = false;
  }

  if (condition.op === "==") return normalized == expected;
  if (condition.op === "!=") return normalized != expected;
  return false;
}
