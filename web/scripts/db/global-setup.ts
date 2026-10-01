/**
 * vitest globalSetup for `npm run test:db` (vitest.db.config.ts): one throw-away Postgres cluster
 * and one template database (shim + supabase/migrations) for the whole run. Test files get the
 * cluster with `inject('hbCluster')` (see vitest.ts) and clone their own database from the template.
 */

import type { TestProject } from 'vitest/node'
import { startCluster, type ClusterInfo } from './engine'
import { ensureTemplate } from './harness'

declare module 'vitest' {
  export interface ProvidedContext {
    hbCluster: ClusterInfo
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const cluster = await startCluster()
  try {
    await ensureTemplate(cluster)
  } catch (e) {
    await cluster.stop()
    throw e
  }
  project.provide('hbCluster', { host: cluster.host, port: cluster.port, password: cluster.password, dir: cluster.dir })
  return async () => {
    await cluster.stop()
  }
}
