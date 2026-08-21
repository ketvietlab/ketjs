// The repository deployment adds PostgreSQL support to the same application
// declaration shipped by the public KetSuite package.

import { createKetsuiteApp } from '@ketvietlab/ketsuite/app'
import { openStore } from './config.ts'

export const ketsuite = createKetsuiteApp(openStore)
export const apps = [ketsuite]
