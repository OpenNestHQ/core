import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { parseHomeDSL } from '@opennest/lang-core'
import { MockDriver } from '@opennest/devices'
import { runCommand } from '../effect/index.js'
import { createAsk } from './ask.js'
import { createSession } from '../state.js'
import type { Device } from '../types.js'
import type { Middleware } from '../middleware/types.js'

// Deliberately imports nothing that pulls in ../index.js or register-defaults:
// the handlers must be registered by the effect entry point alone.
describe('ask() via @opennest/vm/effect', () => {
  it('works through the @opennest/vm/effect entry point', async () => {
    const driver = new MockDriver()
    driver.seed('tv_salon', { power: false })
    const devices: Device[] = [
      {
        id: 'tv_salon',
        type: 'tv',
        room: 'salon',
        name: 'Salon TV',
        driver,
        driverConfig: {},
      },
    ]
    const ask = createAsk()
    const mw: Middleware = async (ctx, next) => {
      ask(ctx, {
        key: 'mode',
        type: 'choice',
        message: 'Which mode?',
        options: [
          { value: 'cinema', label: 'Cinema' },
          { value: 'day', label: 'Day' },
        ],
      })
      return next()
    }
    const parsed = parseHomeDSL('tv[salon].power = on')
    const ctx = { devices, session: createSession(), middleware: [mw] }

    const first = await Effect.runPromise(
      runCommand({ kind: 'run_program', program: parsed.program }, ctx),
    )
    expect(first.status).toBe('awaiting_interaction')
    const second = await Effect.runPromise(
      runCommand(
        {
          kind: 'resume_interaction',
          response: {
            interactionId: first.interaction!.id,
            type: 'choice',
            value: 'day',
          },
        },
        ctx,
      ),
    )
    expect(second.status).toBe('success')
  })
})
