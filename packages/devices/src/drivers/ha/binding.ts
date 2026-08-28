export interface HARawPropertyConfig {
  entity: string
  attribute?: string
  set_service?: string
  set_value_key?: string
}

export interface HARawActionConfig {
  service: string
  target?: Record<string, unknown>
  data?: Record<string, unknown>
}

export type HAGetStrategy =
  | { kind: 'state' }
  | { kind: 'attribute'; attribute: string }
  | { kind: 'template'; template: string }
  | { kind: 'script'; script: string }
  | {
      kind: 'service_response'
      service: string
      fields?: Record<string, unknown>
    }

export type HASetStrategy =
  | { kind: 'inferred' }
  | { kind: 'service'; service: string; key?: string }
  | { kind: 'script'; script: string; fields: Record<string, unknown> }

export type HAActionStrategy =
  | {
      kind: 'service'
      service: string
      target?: Record<string, unknown>
      data?: Record<string, unknown>
    }
  | { kind: 'script'; script: string; fields: Record<string, unknown> }

export interface HABinding {
  get: HAGetStrategy
  set: HASetStrategy
}
