import {
  createAsk,
  createConfirmationMiddleware,
  defineSuggestion,
} from '@opennest/sdk'
import type { Middleware, PlannedAction } from '@opennest/sdk'

// One module-level `ask`: answers are stored per programId, so it is safe to
// share across every house.
const ask = createAsk()

/** Volume above which a TV or speaker change is questioned. */
const LOUD_VOLUME = 60
/** Volume proposed instead of a loud one. */
const QUIET_VOLUME = 30

/** Asks before changing a thermostat's target temperature. */
export const confirmThermostat: Middleware = createConfirmationMiddleware({
  requireConfirmation(action: PlannedAction) {
    return (
      action.device.type === 'thermostat' &&
      action.kind === 'set_property' &&
      action.property === 'temperature'
    )
  },
  // Plain words: the default message shows type and room ids.
  message(action) {
    const value =
      action.kind === 'set_property' && action.value.kind === 'number'
        ? `${action.value.value}°`
        : 'this value'
    return `Set the ${action.device.name} to ${value}?`
  },
})

/**
 * Quiet volume guard: a TV or speaker volume set above `LOUD_VOLUME` asks
 * the user what to do, once per device.
 */
export const quietVolume: Middleware = async (ctx, next) => {
  const { action } = ctx
  if (
    action.kind !== 'set_property' ||
    action.property !== 'volume' ||
    (action.device.type !== 'tv' && action.device.type !== 'speaker') ||
    action.value.kind !== 'number' ||
    action.value.value <= LOUD_VOLUME
  ) {
    return next()
  }

  const requested = action.value.value
  const choice = ask(ctx, {
    key: 'loud-volume',
    type: 'choice',
    message: `${action.device.name}: volume ${requested} is high. What should I do?`,
    options: [
      { value: 'keep', label: `Keep ${requested}` },
      { value: 'lower', label: `Lower to ${QUIET_VOLUME}` },
      { value: 'skip', label: "Don't change this device" },
    ],
  })

  if (choice === 'skip') return { kind: 'skipped', reason: 'volume kept' }
  if (choice === 'lower') {
    action.value = { kind: 'number', value: QUIET_VOLUME }
  }
  return next()
}

/**
 * Door PIN: unlocking a door requires a PIN, asked once per statement. A
 * wrong PIN blocks the unlock. Demo only: the PIN comes from `DEMO_DOOR_PIN`
 * (default `1234`).
 */
export const doorPin: Middleware = async (ctx, next) => {
  const { action } = ctx
  if (
    action.kind !== 'invoke_action' ||
    action.device.type !== 'door' ||
    action.method !== 'unlock'
  ) {
    return next()
  }

  const pin = ask(ctx, {
    key: 'door-pin',
    type: 'text_input',
    message: 'PIN to unlock the door:',
    placeholder: '4 digits',
    scope: 'statement',
  })

  if (pin !== (process.env.DEMO_DOOR_PIN ?? '1234')) {
    return { kind: 'blocked', middlewareName: 'doorPin', reason: 'wrong PIN' }
  }
  return next()
}

type Value = Extract<PlannedAction, { kind: 'set_property' }>['value']

// Suggestion names are process-wide: define it once, at module level.
const ambiance = defineSuggestion('copilotkit-demo.ambiance', {
  apply(answer, devices) {
    const writes: [string, Value][] =
      answer === 'cinema'
        ? [
            ['brightness', { kind: 'number', value: 20 }],
            ['color', { kind: 'string', value: 'warm_white' }],
          ]
        : [
            ['brightness', { kind: 'number', value: 80 }],
            ['mode', { kind: 'string', value: 'reading' }],
          ]
    return devices.flatMap(device =>
      writes.map(([property, value]): PlannedAction => ({
        kind: 'set_property',
        device,
        property,
        value,
      })),
    )
  },
})

/** Once lights are switched on, offers a cinema or reading ambiance. */
export const suggestAmbiance: Middleware = async (ctx, next) => {
  const { action } = ctx
  if (
    action.kind === 'set_property' &&
    action.device.type === 'light' &&
    action.property === 'power' &&
    action.value.kind === 'power' &&
    action.value.value === 'on'
  ) {
    ambiance.suggest(ctx, {
      key: 'ambiance',
      type: 'choice',
      message: 'Which ambiance for these lights?',
      options: [
        { value: 'cinema', label: 'Cinema (dim, warm white)' },
        { value: 'reading', label: 'Reading (bright, reading mode)' },
      ],
    })
  }
  return next()
}

export const demoMiddleware: Middleware[] = [
  confirmThermostat,
  quietVolume,
  doorPin,
  suggestAmbiance,
]
