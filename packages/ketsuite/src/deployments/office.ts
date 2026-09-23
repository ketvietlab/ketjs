import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import type { OpenStore } from '@ketvietlab/ketjs'
import * as suite from '../index.ts'
import { officeRoleTemplates } from '../role-templates.ts'
import {
  commonBusinessModules,
  productDefaults,
  productPermissions,
  productQueues,
  productServe,
} from './common.ts'

const modules = [
  ...commonBusinessModules,
  suite.pricing,
  suite.account,
  suite.purchase,
  suite.crm,
  suite.crmSale,
  suite.crmBackend,
  suite.purchaseBackend,
  // `livedoc` comes first because `flow_backend` depends on it: issue
  // descriptions, wiki pages and the project brief are collaborative documents.
  suite.livedoc,
  suite.flow,
  suite.flowBackend,
  suite.accountBackend,
]

/** Office: the back office of a services business — CRM, projects, purchasing and accounting. */
export const createOfficeDeployment = (openStore: OpenStore = sqliteStore) =>
  defineDeployment({
    name: 'office',
    datastore: 'office',
    modules,
    permissions: productPermissions(modules, officeRoleTemplates),
    theme: suite.paperTheme,
    worker: { queues: productQueues },
    serve: { ...productServe(openStore), defaults: productDefaults('office') },
  })
