import { describe, expect, it } from 'vitest'
import { buildInjectAgentGuidance } from './orchestration-inject-agent-guidance'
import { OrcaRuntimeService } from '../../orca-runtime'

describe('buildInjectAgentGuidance', () => {
  it('names the roster it was given, deduped and sorted', () => {
    const message = buildInjectAgentGuidance('term_a', ['codex', 'agy', 'claude', 'claude'])

    expect(message).toContain('Cannot dispatch --inject to terminal term_a')
    expect(message).toContain('no recognized agent detected')
    expect(message).toContain('(agy, claude, codex)')
  })

  it('falls back to examples when the roster is unavailable', () => {
    expect(buildInjectAgentGuidance('term_a', [])).toContain('(agy, claude, codex)')
  })
})

describe('OrcaRuntimeService.listEnabledAgentProcessNames', () => {
  it('includes antigravity when nothing is disabled', () => {
    const names = new OrcaRuntimeService().listEnabledAgentProcessNames()

    expect(names).toContain('agy')
    expect(names).toContain('claude')
  })

  it('omits agents the user disabled', () => {
    const runtime = new OrcaRuntimeService({
      getSettings: () => ({ disabledTuiAgents: ['antigravity'] })
    } as never)

    const names = runtime.listEnabledAgentProcessNames()
    expect(names).not.toContain('agy')
    expect(names).toContain('claude')
  })
})
