import { TUI_AGENT_CONFIG } from '../../../../shared/tui-agent-config'

/**
 * Why: the inject-rejection message used to hardcode five agent names, which users read as an
 * allowlist and which drifted from the real roster (issue #15125). It is now derived from the
 * same config `recognizeAgentProcess` keys on, so it cannot disagree with what Orca detects.
 * Enablement is deliberately not applied: `disabledTuiAgents` only gates Orca's launchers, so an
 * agent the user disabled but started by hand still injects fine and belongs in this list.
 */
const RECOGNIZED_AGENT_PROCESS_NAMES = [
  ...new Set(
    Object.values(TUI_AGENT_CONFIG)
      .map((config) => config.expectedProcess.trim())
      .filter(Boolean)
  )
].sort()

export function buildInjectAgentGuidance(terminal: string): string {
  return (
    `Cannot dispatch --inject to terminal ${terminal}: no recognized agent detected. ` +
    `Orca detects these agent CLIs (${RECOGNIZED_AGENT_PROCESS_NAMES.join(', ')}). ` +
    'Start one in the terminal and let it finish launching, ' +
    'or dispatch without --inject and send the prompt manually.'
  )
}
