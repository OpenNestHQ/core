import { DemoApp } from '@/components/demo-app'
import { getLlmConfig } from '@/lib/server/llm'

// Read the LLM env vars at request time, not at build time.
export const dynamic = 'force-dynamic'

export default function Page() {
  return <DemoApp llmConfigured={getLlmConfig() !== null} />
}
