export function LlmBanner() {
  return (
    <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
      No language model is configured: set <code>OPENAI_API_KEY</code> or{' '}
      <code>OPENAI_BASE_URL</code> (see <code>.env.example</code>) and restart.
      You can still type HomeDSL directly in Advanced mode.
    </div>
  )
}
