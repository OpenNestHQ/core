import { copilotHandler } from '@/lib/server/runtime'

// The VM, the houses and the paused sessions live in this Node process.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = copilotHandler
export const POST = copilotHandler
export const PATCH = copilotHandler
export const DELETE = copilotHandler
