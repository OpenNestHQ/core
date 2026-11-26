import { describe, expect, it } from 'vitest'
import type { UserInteraction } from '@opennest/sdk'
import { REASONS } from '../shared/interrupts'
import type { InterruptMetadata } from '../shared/interrupts'
import { toInterrupt, toResumeAnswer } from './interrupt-mapping'

const deviceSelection: UserInteraction = {
  id: 'i-dev',
  type: 'device_selection',
  message: 'Which TV?',
  devices: [
    {
      id: 'tv_living_room',
      name: 'Living Room TV',
      type: 'tv',
      room: 'living_room',
    },
    {
      id: 'tv_living_room_2',
      name: 'Living Room TV 2',
      type: 'tv',
      room: 'living_room',
    },
  ],
}
const confirmation: UserInteraction = {
  id: 'i-conf',
  type: 'confirmation',
  message: 'Set the thermostat to 20?',
}
const choice: UserInteraction = {
  id: 'i-choice',
  type: 'choice',
  message: 'Volume 80 is high',
  options: [
    { value: 'keep', label: 'Keep 80' },
    { value: 'lower', label: 'Lower to 30' },
  ],
}
const textInput: UserInteraction = {
  id: 'i-text',
  type: 'text_input',
  message: 'PIN to unlock the door:',
  placeholder: '4 digits',
}
const numberInput: UserInteraction = {
  id: 'i-num',
  type: 'number_input',
  message: 'Brightness?',
  min: 0,
  max: 100,
}
const actionParameter: UserInteraction = {
  id: 'i-param',
  type: 'action_parameter',
  message: 'Missing parameters',
  deviceName: 'Living Room Speaker',
  action: 'announce',
  missing: [{ name: 'message', type: 'string' }],
}

const all = [
  deviceSelection,
  confirmation,
  choice,
  textInput,
  numberInput,
  actionParameter,
]

describe('toInterrupt', () => {
  it.each(all)('maps a $type interaction', interaction => {
    const interrupt = toInterrupt(interaction, {})
    expect(interrupt.id).toBe(interaction.id)
    expect(interrupt.reason).toBe(REASONS[interaction.type])
    expect(interrupt.message).toBe(interaction.message)
    expect((interrupt.metadata as InterruptMetadata).interaction).toEqual(
      interaction,
    )
    expect(interrupt.responseSchema).toBeTypeOf('object')
  })

  it('uses the core confirmation reason', () => {
    expect(toInterrupt(confirmation, {}).reason).toBe('confirmation')
  })

  it('binds the interrupt to a tool call', () => {
    expect(toInterrupt(confirmation, { toolCallId: 'tc1' }).toolCallId).toBe(
      'tc1',
    )
  })

  it('carries the error into metadata', () => {
    const interrupt = toInterrupt(textInput, { error: 'Wrong PIN format' })
    expect((interrupt.metadata as InterruptMetadata).error).toBe(
      'Wrong PIN format',
    )
  })
})

describe('toResumeAnswer', () => {
  it('maps a device choice', () => {
    expect(
      toResumeAnswer(deviceSelection, { deviceId: 'tv_living_room_2' }),
    ).toEqual({
      ok: true,
      answer: { type: 'device_selection', deviceId: 'tv_living_room_2' },
    })
  })

  it('maps a confirmation', () => {
    expect(toResumeAnswer(confirmation, { approved: false })).toEqual({
      ok: true,
      answer: { type: 'confirmation', confirmed: false },
    })
  })

  it('maps a choice', () => {
    expect(toResumeAnswer(choice, { value: 'lower' })).toEqual({
      ok: true,
      answer: { type: 'choice', value: 'lower' },
    })
  })

  it('maps a text answer', () => {
    expect(toResumeAnswer(textInput, { value: '1234' })).toEqual({
      ok: true,
      answer: { type: 'text_input', text: '1234' },
    })
  })

  it('maps a number answer', () => {
    expect(toResumeAnswer(numberInput, { value: 40 })).toEqual({
      ok: true,
      answer: { type: 'number_input', value: 40 },
    })
  })

  it('maps action parameters to strings', () => {
    expect(
      toResumeAnswer(actionParameter, { values: { message: 'Dinner!' } }),
    ).toEqual({
      ok: true,
      answer: { type: 'action_parameter', values: { message: 'Dinner!' } },
    })
  })

  it('rejects an unknown device id', () => {
    expect(toResumeAnswer(deviceSelection, { deviceId: 'tv_bedroom' }).ok).toBe(
      false,
    )
  })

  it('rejects a number above max', () => {
    expect(toResumeAnswer(numberInput, { value: 101 }).ok).toBe(false)
  })

  it('rejects a choice that was not offered', () => {
    expect(toResumeAnswer(choice, { value: 'skip' }).ok).toBe(false)
  })

  it('rejects an empty object for a confirmation', () => {
    expect(toResumeAnswer(confirmation, {}).ok).toBe(false)
  })

  it('rejects a text answer that is not a string', () => {
    expect(toResumeAnswer(textInput, { value: 42 }).ok).toBe(false)
  })

  it('rejects a missing required parameter', () => {
    expect(toResumeAnswer(actionParameter, { values: {} }).ok).toBe(false)
  })
})
