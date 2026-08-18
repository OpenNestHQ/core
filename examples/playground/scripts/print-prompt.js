/* eslint-disable no-undef */
import { OpenNestClient } from '@opennest/sdk'
import { createPlaygroundRegistry } from '../dist/devices.js'
import { createPlaygroundSystemPrompt } from '../dist/prompt.js'

const client = new OpenNestClient({ devices: createPlaygroundRegistry() })

process.stdout.write(createPlaygroundSystemPrompt(client) + '\n')
