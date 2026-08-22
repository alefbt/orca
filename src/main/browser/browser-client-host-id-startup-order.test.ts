import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The hosting identity has to be resolved before the first window exists: window creation stamps it
 * into the renderer's argv and cannot wait on profile I/O. A renderer stamped with one id while the
 * lease attaches under another stops recognizing the pages it is hosting.
 *
 * Why a census. The invariant is an ordering inside one synchronous stretch of index.ts, and the
 * failure is silent: an `await` added before the call lets an activation event (second-instance,
 * open-url, dock reactivation) open a window first, the accessor mints a process-local id, and
 * every behavioural test still passes because hosting itself keeps working — only survival across
 * a relaunch is lost.
 */
const INDEX_PATH = fileURLToPath(new URL('../index.ts', import.meta.url))

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('browser client host id startup order', () => {
  const source = withoutComments(readFileSync(INDEX_PATH, 'utf8'))
  const readyIndex = source.indexOf('app.whenReady().then(')
  const initIndex = source.indexOf('initializeBrowserClientHostId(')

  it('resolves the hosting identity inside the app-ready block', () => {
    expect(readyIndex).toBeGreaterThan(-1)
    expect(initIndex).toBeGreaterThan(readyIndex)
    expect(source.split('initializeBrowserClientHostId(').length - 1).toBe(1)
  })

  it('reaches the resolution with nothing awaited before it', () => {
    expect(source.slice(readyIndex, initIndex).match(/\bawait\b/g)).toBeNull()
  })
})
