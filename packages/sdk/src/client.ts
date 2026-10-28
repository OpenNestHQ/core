import { parseHomeDSL, ParseError, OpenNestPrompt } from '@opennest/lang-core'
import type {
  Program,
  ParseErrorInfo,
  PromptOptions,
} from '@opennest/lang-core'
import type { DeviceRegistry, PromptDefinitions } from '@opennest/devices'
import { executeCommand, createSession, validateProgram } from '@opennest/vm'
import type {
  Device,
  Middleware,
  Session,
  VMEventBus,
  VMContext,
  VMResult,
  VMCommand,
  UserInteraction,
  UserResponse,
  VMError,
} from '@opennest/vm'
import { toRunResult } from './result.js'
import type { RunResult } from './result.js'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

/** A `UserResponse` without its `interactionId` — `resumePending` injects it. */
export type ResumeAnswer = DistributiveOmit<UserResponse, 'interactionId'>

export interface OpenNestClientOptions {
  devices: Device[] | DeviceRegistry
  promptDefinitions?: PromptDefinitions
  middleware?: Middleware[]
  eventBus?: VMEventBus
  onInteraction?: (interaction: UserInteraction) => void | Promise<void>
  onInteractionError?: (error: unknown, interaction: UserInteraction) => void
}

export type OpenNestClientFromYamlOptions = Omit<
  OpenNestClientOptions,
  'devices'
>

export interface DSLFeedback {
  program: Program | null
  parseErrors: ParseErrorInfo[]
  validationErrors: VMError[]
  ok: boolean
}

export class OpenNestClient {
  private readonly devices: Device[]
  private readonly registry: DeviceRegistry | undefined
  private readonly promptDefinitions: PromptDefinitions | undefined
  private readonly middleware: Middleware[]
  private readonly eventBus: VMEventBus | undefined
  private readonly onInteraction:
    ((interaction: UserInteraction) => void | Promise<void>) | undefined
  private readonly onInteractionError:
    ((error: unknown, interaction: UserInteraction) => void) | undefined
  private session: Session
  private lastInteraction: UserInteraction | null = null

  constructor(options: OpenNestClientOptions) {
    if (Array.isArray(options.devices)) {
      this.devices = options.devices
      this.registry = undefined
    } else {
      this.registry = options.devices
      this.devices = options.devices.getDevices()
    }
    this.promptDefinitions = options.promptDefinitions
    this.middleware = options.middleware ?? []
    this.eventBus = options.eventBus
    this.onInteraction = options.onInteraction
    this.onInteractionError = options.onInteractionError
    this.session = createSession()
  }

  static async fromYaml(
    path: string,
    options: OpenNestClientFromYamlOptions = {},
  ): Promise<OpenNestClient> {
    const { DeviceRegistry } = await import(
      /* webpackIgnore: true */ '@opennest/devices'
    )
    const registry = DeviceRegistry.fromYaml(path)
    return new OpenNestClient({ devices: registry, ...options })
  }

  parse(dsl: string): Program {
    const { program, errors } = parseHomeDSL(dsl)
    if (errors.length > 0) {
      const first = errors[0]!
      throw new ParseError(first.message, first.line, first.column)
    }
    return program
  }

  buildPrompt(promptOptions?: PromptOptions): string {
    const defs = this.promptDefinitions ?? this.registry?.getPromptDefinitions()
    if (!defs) {
      throw new Error(
        'buildPrompt needs prompt definitions: construct OpenNestClient with a DeviceRegistry or pass promptDefinitions in options.',
      )
    }
    return new OpenNestPrompt(
      defs.devices,
      defs.rooms,
      defs.owners,
      defs.tags,
    ).prompt(promptOptions)
  }

  analyze(dsl: string): DSLFeedback {
    const { program, errors: parseErrors } = parseHomeDSL(dsl)
    if (parseErrors.length > 0) {
      return { program: null, parseErrors, validationErrors: [], ok: false }
    }
    const validationErrors = validateProgram(
      program,
      this.devices,
      this.session,
    )
    return {
      program,
      parseErrors,
      validationErrors,
      ok: validationErrors.length === 0,
    }
  }

  async execute(program: Program): Promise<RunResult> {
    return toRunResult(await this.run({ kind: 'run_program', program }))
  }

  async runDsl(dsl: string): Promise<RunResult> {
    return this.execute(this.parse(dsl))
  }

  async resume(response: UserResponse): Promise<RunResult> {
    return toRunResult(await this.run({ kind: 'resume_interaction', response }))
  }

  async resumePending(response: ResumeAnswer): Promise<RunResult> {
    const pending = this.lastInteraction
    if (pending === null) {
      return failedRunResult(
        'no_pending_interaction',
        'No interaction is pending. Execute a program first.',
      )
    }
    if (response.type !== pending.type) {
      return failedRunResult(
        'interaction_type_mismatch',
        `Pending interaction is ${pending.type}, got ${response.type}.`,
      )
    }
    if (
      pending.type === 'device_selection' &&
      response.type === 'device_selection'
    ) {
      const valid = pending.devices.map(d => d.id)
      if (!valid.includes(response.deviceId)) {
        return failedRunResult(
          'unknown_device_id',
          `Unknown device "${response.deviceId}". Valid choices: ${valid.join(', ')}.`,
        )
      }
    }
    return this.resume({ ...response, interactionId: pending.id })
  }

  async cancel(): Promise<RunResult> {
    return toRunResult(await this.run({ kind: 'cancel_execution' }))
  }

  getSession(): Session {
    return this.session
  }

  getPendingInteraction(): UserInteraction | null {
    return this.lastInteraction
  }

  async whenReady(): Promise<void> {
    await this.registry?.whenReady()
  }

  async close(): Promise<void> {
    await this.registry?.close()
  }

  private async run(command: VMCommand): Promise<VMResult> {
    const result = await executeCommand(command, this.buildContext())
    this.session = result.session
    this.lastInteraction =
      result.status === 'awaiting_interaction' && result.interaction !== null
        ? result.interaction
        : null
    if (
      result.status === 'awaiting_interaction' &&
      result.interaction !== null
    ) {
      this.notifyInteraction(result.interaction)
    }
    return result
  }

  private notifyInteraction(interaction: UserInteraction): void {
    const onInteraction = this.onInteraction
    if (onInteraction === undefined) return
    try {
      Promise.resolve(onInteraction(interaction)).catch(error => {
        try {
          this.routeInteractionError(error, interaction)
        } catch {
          // swallow onInteractionError failures
        }
      })
    } catch (error) {
      try {
        this.routeInteractionError(error, interaction)
      } catch {
        // swallow onInteractionError failures
      }
    }
  }

  private routeInteractionError(
    error: unknown,
    interaction: UserInteraction,
  ): void {
    if (this.onInteractionError !== undefined) {
      this.onInteractionError(error, interaction)
    }
  }

  private buildContext(): VMContext {
    const context: VMContext = {
      devices: this.devices,
      session: this.session,
    }
    if (this.middleware.length > 0) {
      context.middleware = this.middleware
    }
    if (this.eventBus !== undefined) {
      context.eventBus = this.eventBus
    }
    return context
  }
}

function failedRunResult(code: string, message: string): RunResult {
  return {
    status: 'error',
    executed: [],
    interaction: null,
    errors: [{ code, message }],
  }
}
