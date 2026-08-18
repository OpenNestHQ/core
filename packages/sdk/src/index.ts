export { OpenNestClient } from './client.js'
export type { OpenNestClientOptions, DSLFeedback } from './client.js'

export { ParseError } from '@opennest/lang-core'
export type {
  Program,
  ParseErrorInfo,
  PromptOptions,
} from '@opennest/lang-core'

export { createConfirmationMiddleware, DefaultVMEventBus } from '@opennest/vm'
export type {
  Device,
  Session,
  VMResult,
  VMError,
  VMStatus,
  UserInteraction,
  UserResponse,
  DeviceSelectionInteraction,
  Middleware,
  VMEventBus,
  VMEvent,
  ExecutedStatement,
  StateChange,
  PlannedAction,
} from '@opennest/vm'

export type { DeviceRegistry, PromptDefinitions } from '@opennest/devices'
