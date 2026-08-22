import { randomUUID } from 'node:crypto'

const browserHostClientId = randomUUID()

/**
 * The id every browser-host lease this app takes out is minted under, and therefore the id a page's
 * placement carries when the guest runs in this app's own renderer rather than another client's.
 *
 * Its own module so window creation can stamp it into a renderer's argv without pulling in the
 * client-host runtime graph.
 */
export function getBrowserClientHostId(): string {
  return browserHostClientId
}
