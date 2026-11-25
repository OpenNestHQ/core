import { createAsk, defineSuggestion } from '@opennest/sdk'
import type { Middleware, PlannedAction } from '@opennest/sdk'

const ask = createAsk()

/** Volume above which a TV or speaker change is questioned. */
const LOUD_VOLUME = 60
/** Volume proposed instead of a loud one. */
const QUIET_VOLUME = 30

/**
 * Quiet volume guard: a TV or speaker volume set above `LOUD_VOLUME` asks
 * the user what to do, once per device (an `@all(speaker)` asks for each
 * one). Keep the requested volume, lower it to `QUIET_VOLUME`, or leave this
 * device unchanged.
 *
 *   speaker[living_room].volume = 80
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
 * Door PIN: unlocking a door requires a PIN, asked once per statement (one
 * PIN for `@all(door).unlock()`). A wrong PIN blocks the unlock. Demo only:
 * the PIN comes from `PLAYGROUND_DOOR_PIN` (default `1234`).
 *
 *   door[entrance].unlock()
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
    placeholder: '4 chiffres',
    scope: 'statement',
  })

  if (pin !== (process.env.PLAYGROUND_DOOR_PIN ?? '1234')) {
    return { kind: 'blocked', middlewareName: 'doorPin', reason: 'wrong PIN' }
  }
  return next()
}

/**
 * Lighting ambiance: once lights are switched on, offers `cinema` (dim, warm
 * white) or `reading` (bright, reading mode). Answer it with `:a <n> <value>`.
 *
 *   light[living_room].power = on
 */
type Value = Extract<PlannedAction, { kind: 'set_property' }>['value']

const ambiance = defineSuggestion('playground.ambiance', {
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
