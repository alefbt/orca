/**
 * Why: the inject-rejection message used to hardcode five agent names, which users read as an
 * allowlist and which drifted from the real roster (issue #15125). It is now derived from the
 * host's enabled agents so it can never disagree with what Orca actually recognizes.
 */
const FALLBACK_AGENT_PROCESS_NAMES = ['agy', 'claude', 'codex']

export function buildInjectAgentGuidance(
  terminal: string,
  enabledAgentProcessNames: readonly string[]
): string {
  const recognized = [
    ...new Set(enabledAgentProcessNames.map((name) => name.trim()).filter(Boolean))
  ].sort()
  // Why: settings can be unavailable here, and the throw path must never itself throw.
  const listed = recognized.length > 0 ? recognized : FALLBACK_AGENT_PROCESS_NAMES
  return (
    `Cannot dispatch --inject to terminal ${terminal}: no recognized agent detected. ` +
    `Orca detects any enabled agent CLI (${listed.join(', ')}). ` +
    'Start one in the terminal and let it finish launching, ' +
    'or dispatch without --inject and send the prompt manually.'
  )
}
