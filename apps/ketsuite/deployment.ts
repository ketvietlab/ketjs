// The repository deployment adds PostgreSQL support to the same application
// declaration shipped by the public KetSuite package.

import { createKetsuiteDeployment } from '@ketvietlab/ketsuite/deployment'
import { openStore } from './config.ts'

export const ketsuite = createKetsuiteDeployment(openStore)
export const deployments = [ketsuite]
