import type { Value, PowerValue, NumberValue, StringValue } from "@opennest/lang-core";
import type { Device, StateChange } from "./types.js";

export function executeAssignment(
  device: Device,
  property: string,
  value: Value,
): StateChange {
  const oldValue = device.state[property];
  const newValue = extractValue(value);

  device.state[property] = newValue;

  return {
    deviceId: device.id,
    property,
    oldValue,
    newValue,
  };
}

export function executeIncrement(
  device: Device,
  property: string,
  value: Value,
): StateChange {
  const currentValue = device.state[property];
  const increment = extractNumericValue(value);

  if (typeof currentValue === "number") {
    const newValue = currentValue + increment;
    device.state[property] = newValue;
    return {
      deviceId: device.id,
      property,
      oldValue: currentValue,
      newValue,
    };
  }

  const newValue = increment;
  device.state[property] = newValue;
  return {
    deviceId: device.id,
    property,
    oldValue: currentValue,
    newValue,
  };
}

export function executeQuery(
  device: Device,
  property: string,
): StateChange {
  const currentValue = device.state[property];
  return {
    deviceId: device.id,
    property,
    oldValue: currentValue,
    newValue: currentValue,
  };
}

export function executeAction(
  device: Device,
  method: string,
): StateChange {
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
