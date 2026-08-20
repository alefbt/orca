import { describe, expect, it } from 'vitest'
import {
  normalizeNativeChatUserText,
  normalizedNativeChatUserMessageText
} from '../../shared/native-chat-image-transcript-markers'
import { decodeClaudeTranscriptLine } from './transcript-line-decoders-claude'

// Captured verbatim from a real Claude Code session JSONL after a long
// multi-line message was sent from the Orca mobile composer. The send path
// bundles its Ctrl+U kill-line byte into the same terminal write as the body,
// and the TUI took that burst as a paste, so U+0015 reached the transcript as
// part of the prompt itself.
const CAPTURED_MOBILE_SEND_LINE =
  '{"parentUuid":"bd33a9fc-589b-4ed7-9e92-33e63841526a","isSidechain":false,"promptId":"fbf407f0-6c4c-4bcb-8b36-8abb06e1fee7","type":"user","message":{"role":"user","content":"\\u0015line 000 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 001 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 002 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 003 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 004 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 005 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 006 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 007 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 008 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 009 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 010 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 011 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 012 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 013 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 014 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 015 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 016 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 017 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 018 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 019 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 020 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 021 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 022 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 023 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 024 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\nline 025 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},"uuid":"5c01bfaf-1a8a-421c-9ce7-f6edc2b26a98","timestamp":"2026-08-17T13:46:37.092Z","permissionMode":"bypassPermissions","origin":{"kind":"human"},"promptSource":"typed","userType":"external","entrypoint":"cli","cwd":"/Users/brennanbenson/orca/workspaces/orca/pr-13553-qa","sessionId":"76e09e7a-7a0f-4ce5-8168-eda6595bbe68","version":"2.1.233","gitBranch":"brennanb2025/pr-13553-qa"}'

/** Exactly what the composer held: the captured prompt without the control byte. */
const COMPOSER_TEXT =
  'line 000 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 001 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 002 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 003 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 004 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 005 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 006 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 007 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 008 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 009 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 010 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 011 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 012 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 013 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 014 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 015 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 016 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 017 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 018 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 019 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 020 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 021 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 022 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 023 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 024 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nline 025 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

describe('decodeClaudeTranscriptLine on a mobile-sent prompt', () => {
  it('keeps the Ctrl+U byte the TUI pasted into the prompt', () => {
    const message = decodeClaudeTranscriptLine(CAPTURED_MOBILE_SEND_LINE, 'fallback')
    expect(message?.role).toBe('user')
    expect(message?.blocks[0]).toEqual({
      type: 'text',
      text: `\u0015${COMPOSER_TEXT}`
    })
  })

  it('normalizes to the composer text so the optimistic echo can retire', () => {
    const message = decodeClaudeTranscriptLine(CAPTURED_MOBILE_SEND_LINE, 'fallback')!
    expect(normalizedNativeChatUserMessageText(message)).toBe(
      normalizeNativeChatUserText(COMPOSER_TEXT)
    )
  })
})
