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
  description?: string;
  capabilities: Capability[];
}

export interface RoomDefinition {
  description?: string;
}

export interface OwnerDefinition {
  name: string;
  description?: string;
}

export interface TagDefinition {
  description?: string;
}

export interface PromptOptions {
  preamble?: string;
  examples?: string[];
  additionalRules?: string[];
  customInstruction?: string;
}
