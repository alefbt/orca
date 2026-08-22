import type { RemoteRuntimeSubscription } from '../../shared/remote-runtime-client'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'

/**
 * Resolves the sender for traffic that has to ride the lease's own connection, or fails closed.
 *
 * Why it fails rather than falling back to a plain runtime call: the runtime binds page traffic to
 * the connection its lease attached on, so a request sent any other way is refused as a stale lease
 * — a silent no-op rather than an error the caller can see.
 */
export function requireBrowserHostLeaseSendRequest(
  sendRequest: RemoteRuntimeSubscription['sendRequest'] | undefined,
  unavailableMessage: string
): NonNullable<RemoteRuntimeSubscription['sendRequest']> {
  if (!sendRequest) {
    throw new RemoteRuntimeClientError('remote_runtime_unavailable', unavailableMessage)
  }
  return sendRequest
}
