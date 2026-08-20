import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { normalizeReconcileText } from './mobile-native-chat-draft-reconcile'
import {
  appendMobileNativeChatPending,
  type MobileNativeChatSendOrigin
} from './mobile-native-chat-pending-echo'
import { retireLandedMobileNativeChatPending } from './mobile-native-chat-pending-retirement'

const NO_IMAGE_ECHOES: ReadonlySet<string> = new Set()

/** A send captured against `messages`, exactly as `captureSendOrigin` builds it. */
function sendOrigin(
  text: string,
  messages: readonly NativeChatMessage[]
): MobileNativeChatSendOrigin {
  const normalizedText = normalizeReconcileText(text)
  return {
    draftKey: 'host\0worktree\0tab',
    pendingKey: 'host\0worktree\0tab\0session',
    normalizedText,
    baselineOccurrences: messages.filter(
      (message) =>
        message.role === 'user' &&
        normalizeReconcileText(
          message.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ')
        ) === normalizedText
    ).length,
    baselineTailMessageId: messages.at(-1)?.id ?? null,
    baselineResolved: true
  }
}

function userTurn(id: string, text: string): NativeChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', text }],
    timestamp: 1000,
    source: 'transcript'
  }
}

describe('appendMobileNativeChatPending ordinals for repeated sends', () => {
  const KEY = 'host\0worktree\0tab\0session'
  // A multi-line prompt is where a raw trim() and the whitespace-collapsed
  // normalization diverge, so it is the shape that mis-ordinals a repeat.
  const MULTILINE = 'first line of the prompt\nsecond line of the prompt'

  it('gives a repeated multi-line send the next ordinal', () => {
    const baseline = [userTurn('m1', 'unrelated')]
    const first = appendMobileNativeChatPending(
      {},
      KEY,
      'p1',
      sendOrigin(MULTILINE, baseline),
      MULTILINE
    )
    const both = appendMobileNativeChatPending(
      first,
      KEY,
      'p2',
      sendOrigin(MULTILINE, baseline),
      MULTILINE
    )

    expect(both[KEY]?.map((item) => item.expectedOccurrence)).toEqual([1, 2])
  })

  it('retires only the first echo when the first of two identical rows lands', () => {
    const baseline = [userTurn('m1', 'unrelated')]
    const pending = appendMobileNativeChatPending(
      appendMobileNativeChatPending({}, KEY, 'p1', sendOrigin(MULTILINE, baseline), MULTILINE),
      KEY,
      'p2',
      sendOrigin(MULTILINE, baseline),
      MULTILINE
    )[KEY]!
    const landedOnce = [...baseline, userTurn('m2', MULTILINE)]

    expect(
      retireLandedMobileNativeChatPending(landedOnce, pending, NO_IMAGE_ECHOES).map(
        (item) => item.id
      )
    ).toEqual(['p2'])
  })

  it('still counts a single-line repeat, which never regressed', () => {
    const baseline = [userTurn('m1', 'unrelated')]
    const both = appendMobileNativeChatPending(
      appendMobileNativeChatPending({}, KEY, 'p1', sendOrigin('ping', baseline), 'ping'),
      KEY,
      'p2',
      sendOrigin('ping', baseline),
      'ping'
    )

    expect(both[KEY]?.map((item) => item.expectedOccurrence)).toEqual([1, 2])
  })
})
