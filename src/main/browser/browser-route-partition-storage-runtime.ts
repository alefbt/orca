import { app } from 'electron'
import { listEnvironments } from '../../shared/runtime-environment-store'
import { deriveBrowserRoutePartitionStorageScope } from './browser-route-identity'
import {
  findBrowserRoutePartitionsForStorageScope,
  findOrphanedBrowserRoutePartitions,
  releaseBrowserRoutePartitionStorage,
  type BrowserRoutePartitionStorageDependencies
} from './browser-route-partition-storage-lifecycle'
import { activeBrowserRoutePartitionOrcaProfileId } from './browser-route-partition-binding-runtime'
import { browserRoutePartitionStorageDependencies } from './browser-route-partition-storage-dependencies'
import { browserRouteSessionRegistry } from './browser-route-session-runtime'

export type BrowserRoutePartitionStorageClear = {
  clearedPartitions: string[]
  livePartitions: string[]
}

/**
 * Sweeps route partitions whose owning environment record is gone.
 *
 * Runs at startup only, and never treats a disconnected host as removed: an
 * environment that still exists in the store keeps every partition it owns.
 */
export async function collectOrphanedBrowserRoutePartitionStorage(): Promise<string[]> {
  const orcaProfileId = activeBrowserRoutePartitionOrcaProfileId()
  if (!orcaProfileId) {
    return []
  }
  const dependencies = storageDependencies()
  const liveStorageScopes = new Set(
    listEnvironments(app.getPath('userData')).map((environment) =>
      deriveBrowserRoutePartitionStorageScope({ orcaProfileId, environmentId: environment.id })
    )
  )
  const orphans = findOrphanedBrowserRoutePartitions(dependencies, liveStorageScopes)
  if (orphans.length === 0) {
    return []
  }
  const released = await releaseBrowserRoutePartitionStorage(dependencies, orphans)
  reportStorageFailures('orphan collection', released.failures)
  return released.clearedPartitions
}

/**
 * Destroys the storage of every route partition owned by a removed environment.
 *
 * Reports the partitions that still had prepared pages separately: they were left intact on
 * purpose, and the caller decides whether a retry after teardown can reach them.
 */
export async function clearBrowserRoutePartitionStorageForEnvironment(
  environmentId: string
): Promise<BrowserRoutePartitionStorageClear> {
  const orcaProfileId = activeBrowserRoutePartitionOrcaProfileId()
  if (!orcaProfileId) {
    return { clearedPartitions: [], livePartitions: [] }
  }
  const dependencies = storageDependencies()
  const partitions = findBrowserRoutePartitionsForStorageScope(
    dependencies,
    deriveBrowserRoutePartitionStorageScope({ orcaProfileId, environmentId })
  )
  if (partitions.length === 0) {
    return { clearedPartitions: [], livePartitions: [] }
  }
  const released = await releaseBrowserRoutePartitionStorage(dependencies, partitions)
  reportStorageFailures('environment removal', released.failures)
  return { clearedPartitions: released.clearedPartitions, livePartitions: released.livePartitions }
}

function storageDependencies(): BrowserRoutePartitionStorageDependencies {
  return browserRoutePartitionStorageDependencies((partition) =>
    browserRouteSessionRegistry.isPartitionRetained(partition)
  )
}

function reportStorageFailures(stage: string, failures: readonly unknown[]): void {
  for (const failure of failures) {
    console.warn(
      `[browser-route-partition] ${stage} failed:`,
      failure instanceof Error ? failure.message : String(failure)
    )
  }
}
