import { describe, expect, it } from 'vitest'
import type { SuggestionSummary, UserInteraction } from '@opennest/sdk'
import {
  cancelledTrace,
  dismissedTrace,
  questionTrace,
  suggestionTrace,
} from './answer-trace'

const tvChoice: UserInteraction = {
  id: 'i1',
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

const ambiance: SuggestionSummary = {
  id: 's1',
  question: {
    key: 'ambiance',
    type: 'choice',
    message: 'Which ambiance for these lights?',
    options: [
      { value: 'cinema', label: 'Cinema (dim, warm white)' },
      { value: 'reading', label: 'Reading (bright, reading mode)' },
    ],
  },
  targets: [],
}

describe('questionTrace', () => {
  it('names the picked device, with its id as detail', () => {
    expect(
      questionTrace(tvChoice, {
        type: 'device_selection',
        deviceId: 'tv_living_room_2',
      }),
    ).toEqual({
      kind: 'question',
      type: 'device_selection',
      question: 'Which TV?',
      answer: 'Living Room TV 2',
      detail: 'tv_living_room_2',
      status: 'answered',
    })
  })

  it('says yes or no for a confirmation', () => {
    const confirm: UserInteraction = {
      id: 'i2',
      type: 'confirmation',
      message: 'Set the thermostat to 20°?',
    }
    expect(
      questionTrace(confirm, { type: 'confirmation', confirmed: false }).answer,
    ).toBe('No')
  })

  it('uses the option label for a choice', () => {
    const choice: UserInteraction = {
      id: 'i3',
      type: 'choice',
      message: 'Volume 80 is high',
      options: [{ value: 'lower', label: 'Lower to 30' }],
    }
    const trace = questionTrace(choice, { type: 'choice', value: 'lower' })
    expect(trace.answer).toBe('Lower to 30')
    expect(trace.detail).toBe('lower')
  })

  it('masks a PIN', () => {
    const pin: UserInteraction = {
      id: 'i4',
      type: 'text_input',
      message: 'PIN to unlock the door:',
    }
    const trace = questionTrace(pin, { type: 'text_input', text: '1234' })
    expect(trace.answer).toBe('••••')
    expect(JSON.stringify(trace)).not.toContain('1234')
  })

  it('shows other text answers', () => {
    const name: UserInteraction = {
      id: 'i5',
      type: 'text_input',
      message: 'Name of the scene?',
    }
    expect(
      questionTrace(name, { type: 'text_input', text: 'Movie night' }).answer,
    ).toBe('Movie night')
  })

  it('lists action parameters', () => {
    const params: UserInteraction = {
      id: 'i6',
      type: 'action_parameter',
      message: 'Missing parameters',
      deviceName: 'Living Room Speaker',
      action: 'announce',
      missing: [{ name: 'message', type: 'string' }],
    }
    expect(
      questionTrace(params, {
        type: 'action_parameter',
        values: { message: 'Dinner!' },
      }).answer,
    ).toBe('message: Dinner!')
  })
})

describe('cancelledTrace', () => {
  it('records a cancelled question', () => {
    expect(cancelledTrace(tvChoice)).toEqual({
      kind: 'question',
      type: 'device_selection',
      question: 'Which TV?',
      answer: 'Cancelled',
      status: 'cancelled',
    })
  })
})

describe('suggestionTrace', () => {
  it('uses the option label', () => {
    expect(
      suggestionTrace(ambiance, { type: 'choice', value: 'cinema' }),
    ).toEqual({
      kind: 'suggestion',
      type: 'choice',
      question: 'Which ambiance for these lights?',
      answer: 'Cinema (dim, warm white)',
      detail: 'cinema',
      status: 'answered',
    })
  })

  it('records a dismissed suggestion', () => {
    expect(dismissedTrace(ambiance)).toEqual({
      kind: 'suggestion',
      type: 'choice',
      question: 'Which ambiance for these lights?',
      answer: 'No thanks',
      status: 'dismissed',
    })
  })
})
