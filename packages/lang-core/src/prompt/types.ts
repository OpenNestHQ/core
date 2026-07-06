export type CapabilityValueType = "power" | "number" | "action" | "string" | "enum";

export interface CapabilityParameter {
  name: string;
  type: CapabilityValueType;
  required?: boolean;
}

export interface PropertyCapability {
  kind: "property";
  name: string;
  type: "power" | "number" | "string" | "enum";
  values?: string[];
  range?: [number, number];
}

export interface ActionCapability {
  kind: "action";
  name: string;
  parameters?: CapabilityParameter[];
}

export type Capability = PropertyCapability | ActionCapability;

export interface DeviceDefinition {
  type: string;
  description?: string;
  capabilities: Capability[];
}

export interface RoomDefinition {
  name: string;
  description?: string;
}

export interface PromptConfig {
  devices?: DeviceDefinition[];
  rooms?: RoomDefinition[];
  customInstruction?: string;
  toolName?: string;
}
