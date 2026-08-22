import { describe, expect, it } from 'vitest'
import {
  formatBrowserClientHostIdArgument,
  readBrowserClientHostIdArgument
} from './browser-client-host-id-argument'

const HOST_ID = '6f0f6b1c-6c8e-4a5f-9a6b-8d3f2b1c4e5a'

describe('browser client host id argument', () => {
  it('reads back the id it formatted, from the tail of a real argv', () => {
    const argv = [
      '/Applications/Orca.app/Contents/MacOS/Orca',
      '--type=renderer',
      '--enable-sandbox',
      formatBrowserClientHostIdArgument(HOST_ID)
    ]

    expect(readBrowserClientHostIdArgument(argv)).toBe(HOST_ID)
  })

  // Why an empty value is null and not '': an empty host id would compare equal to nothing a
  // placement can carry, but it would still latch the renderer's cache as an answer.
  it.each([
    ['an argv with no such argument', ['--type=renderer', '--enable-sandbox']],
    ['an empty argv', []],
    ['a flag whose value is empty', ['--orca-browser-client-host-id=']],
    ['a different flag that starts the same way', ['--orca-browser-client-host-idle=1']]
  ])('reports no id for %s', (_label, argv) => {
    expect(readBrowserClientHostIdArgument(argv)).toBeNull()
  })

  // Why the prefix is pinned as a literal: main stamps it and the preload parses it, and a rename
  // on one side alone reads exactly like a client that hosts nothing.
  it('formats the argument main and the preload have to agree on', () => {
    expect(formatBrowserClientHostIdArgument(HOST_ID)).toBe(
      `--orca-browser-client-host-id=${HOST_ID}`
    )
  })
})
