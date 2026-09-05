#!/usr/bin/env node
// KetSuite — the runnable entry.
//
//   npm start                                  SQLite in .ket/ketsuite.db
//   DATABASE_URL=postgres://… npm start        Postgres
//   npm run dev                                the same, restarted on every change
//
// There is nothing else here on purpose: `ket serve` does this from ket.workspace.ts,
// and this file exists only so `node apps/ketsuite/serve.ts` keeps working.

import { serveDeployment } from '@ketvietlab/ketjs'
import { ketsuite } from './deployment.ts'

await serveDeployment(ketsuite)
