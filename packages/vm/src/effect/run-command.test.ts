import { describe, it, expect } from 'vitest'
import { Cause, Effect, Exit, Option } from 'effect'
import { parseHomeDSL } from '@opennest/lang-core'
import { MockDriver } from '@opennest/devices'
import { runCommand } from './index.js'
import { executeCommand } from '../index.js'
import type { Device, VMCommand } from '../index.js'

async function makeLight(driver: MockDriver): Promise<Device> {
  await driver.init({})
  driver.seed('light_salon', { power: false })
  return {
    id: 'light_salon',
    type: 'light',
    room: 'salon',
    name: 'Salon Light',
    driver,
    driverConfig: {},
  }
}

function runProgram(source: string): VMCommand {
  const { program, errors } = parseHomeDSL(source)
  expect(errors).toEqual([])
  return { kind: 'run_program', program }
}

class FailingReadDriver extends MockDriver {
  constructor(private readonly error: unknown) {
    super()
  }

  override async getProperty(): Promise<unknown> {
    throw this.error
  }
}

const ifProgram =
  '@if light[salon].power? == on\nlight[salon].power = off\n@endif'

describe('runCommand', () => {
  it('runCommand returns the same VMResult as executeCommand', async () => {
    const command = runProgram('light[salon].power = on')

    const viaEffect = await Effect.runPromise(
      runCommand(command, { devices: [await makeLight(new MockDriver())] }),
    )
    const viaPromise = await executeCommand(command, {
      devices: [await makeLight(new MockDriver())],
    })

    expect(viaEffect.status).toBe('success')
    expect(viaEffect.status).toBe(viaPromise.status)
    expect(viaEffect.executed[0]!.changes).toEqual(
      viaPromise.executed[0]!.changes,
    )
  })

  it('runCommand fails with DriverError when an @if condition read fails', async () => {
    const err = new Error('device unreachable')
    const light = await makeLight(new FailingReadDriver(err))

    const exit = await Effect.runPromiseExit(
      runCommand(runProgram(ifProgram), { devices: [light] }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (!Exit.isFailure(exit)) return
    const failure = Cause.findErrorOption(exit.cause)
    expect(Option.isSome(failure)).toBe(true)
    if (!Option.isSome(failure)) return
    expect(failure.value._tag).toBe('DriverError')
    expect(failure.value.cause).toBe(err)
  })

  it('executeCommand rejects with the original error when an @if condition read fails', async () => {
    const err = new Error('device unreachable')
    const light = await makeLight(new FailingReadDriver(err))

    await expect(
      executeCommand(runProgram(ifProgram), { devices: [light] }),
    ).rejects.toBe(err)
  })
})
