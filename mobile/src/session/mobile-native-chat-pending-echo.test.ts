import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  countUserTextOccurrences,
  normalizeReconcileText
} from './mobile-native-chat-draft-reconcile'
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
    // Production's own counter, not a copy of it: a private re-implementation
    // would keep passing through exactly the normalization drift under test.
    baselineOccurrences: countUserTextOccurrences(messages, normalizedText),
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

describe('appendMobileNativeChatPending for sends the transcript cannot echo', () => {
  const KEY = 'host\0worktree\0tab\0session'

  // The row this send produces normalizes to null, so neither the count pass nor
  // the glue matcher can ever see it. An echo would pin at the tail forever.
  it('records no echo for a prompt made only of image markers', () => {
    const messages = [userTurn('m1', 'hi')]
    const pending = appendMobileNativeChatPending(
      {},
      KEY,
      'p1',
      sendOrigin('[Image #1]', messages),
      '[Image #1]'
    )

    expect(pending[KEY]).toBeUndefined()
  })

  // The motivation for suppressing it at the source: had the echo been recorded,
  // no later transcript could retire it. Built by hand, because append no longer
  // produces one.
  it('could never have retired such an echo once recorded', () => {
    const stranded = [
      {
        id: 'p1',
        text: '[Image #1]',
        expectedOccurrence: 1,
        baselineTailMessageId: 'm1',
        baselineResolved: true
      }
    ]
    const landed = [userTurn('m1', 'hi'), userTurn('m2', '[Image #1]')]

    expect(retireLandedMobileNativeChatPending(landed, stranded, NO_IMAGE_ECHOES)).toEqual(stranded)
  })

  it('gives a caption-less photo its own ordinal after a marker-only caption', () => {
    const first = appendMobileNativeChatPending(
      {},
      KEY,
      'p1',
      sendOrigin('[Image #1]', []),
      '[Image #1]',
      ['file:///a.jpg']
    )
    const both = appendMobileNativeChatPending(first, KEY, 'p2', sendOrigin('', []), '', [
      'file:///b.jpg'
    ])

    expect(both[KEY]?.map((item) => item.expectedOccurrence)).toEqual([1, 2])
  })

  it('still records an image echo, whose text is empty by design', () => {
    const pending = appendMobileNativeChatPending({}, KEY, 'p1', sendOrigin('', []), '', [
      'file:///photo.jpg'
    ])

    expect(pending[KEY]).toHaveLength(1)
    expect(pending[KEY]?.[0]?.expectedOccurrence).toBe(1)
  })
})
