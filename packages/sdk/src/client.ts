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

  execute(program: Program): Promise<VMResult> {
    return this.run({ kind: 'run_program', program })
  }

  async runDsl(dsl: string): Promise<VMResult> {
    return this.execute(this.parse(dsl))
  }

  resume(response: UserResponse): Promise<VMResult> {
    return this.run({ kind: 'resume_interaction', response })
  }

  cancel(): Promise<VMResult> {
    return this.run({ kind: 'cancel_execution' })
  }

  getSession(): Session {
    return this.session
  }

  private async run(command: VMCommand): Promise<VMResult> {
    const result = await executeCommand(command, this.buildContext())
    this.session = result.session
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
