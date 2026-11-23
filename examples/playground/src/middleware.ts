import { createAsk } from '@opennest/sdk'
import type { Middleware } from '@opennest/sdk'

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
    message: `${action.device.name}: le volume ${requested} est élevé. Que faire ?`,
    options: [
      { value: 'keep', label: `Garder ${requested}` },
      { value: 'lower', label: `Baisser à ${QUIET_VOLUME}` },
      { value: 'skip', label: 'Ne pas changer cet appareil' },
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
    message: 'Code PIN pour déverrouiller la porte :',
    placeholder: '4 chiffres',
    scope: 'statement',
  })

  if (pin !== (process.env.PLAYGROUND_DOOR_PIN ?? '1234')) {
    return { kind: 'blocked', middlewareName: 'doorPin', reason: 'wrong PIN' }
  }
  return next()
}
