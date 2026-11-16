/**
 * Build the handshake instructions. The HomeDSL reference is appended
 * verbatim: `client.buildPrompt()` is the single source of truth for the
 * grammar and this server never rewrites it.
 */
export function buildInstructions(dslReference: string): string {
  return `# What this server does

OpenNest executes HomeDSL programs against a smart-home runtime. You write HomeDSL (grammar below), run it with \`run_dsl\`, and read back a structured result. State (variables, \`$it\`, pending questions) persists across calls within one session.

# Tool protocol

- \`run_dsl { dsl, dryRun? }\` — parse, validate and execute a program. With \`dryRun: true\` it only checks the program and returns \`{ status: "completed" }\` without touching any device.
- Every tool returns an envelope with a \`status\`: \`completed\`, \`waiting_for_user\`, \`blocked\` or \`failed\`. Failures are statuses, never transport errors.
- \`waiting_for_user\` carries an \`interaction\` (device choice, confirmation, text, number, choice or action parameters). Ask the user, then call \`respond { response }\` with the matching \`type\`. You never need an interaction id: \`respond\` targets the single pending interaction.
- While an interaction is pending, \`run_dsl\` is \`blocked\` (\`interaction_pending\`). Resolve it with \`respond\` or abandon it with \`cancel\`.
- \`cancel\` aborts the pending program and resets the session. \`get_session\` reads the current session summary without side effects.
- Calls are executed one at a time, in order.

# Error codes

- \`parse_error\`: the program is not valid HomeDSL. Fix the syntax and call \`run_dsl\` again.
- \`validation_error\`: unknown device, room, property or variable. Fix and retry.
- \`execution_failed\`: a device or the runtime failed while executing.
- \`interaction_pending\`: \`run_dsl\` was called while a question is open. Use \`respond\` or \`cancel\`.
- \`no_pending_interaction\`: \`respond\` was called with nothing to answer.
- \`interaction_aborted\`: too many invalid answers; the interaction was cancelled. Start over.
- \`core_error\`: unexpected internal failure.

Other codes you may see on a failed \`respond\`: \`interaction_id_mismatch\`, \`interaction_type_mismatch\`, \`unknown_device_id\`, \`no_pending_program\`, \`no_session\`, \`unsupported_interaction_type\`.

# HomeDSL reference

${dslReference}`
}
