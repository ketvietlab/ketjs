import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { relations } from './relations.ts'

export default defineModule({
  name: 'odoo_collaboration_import',
  version: '0.1.0',
  depends: ['partner', 'user', 'storage', 'mail', 'mail_transport', 'mail_inbound', 'activity', 'calendar'],
  app: true,
  title: 'Nhập cộng tác từ Odoo',
  summary: 'Snapshot/delta có checkpoint, identity map và báo cáo đối soát dữ liệu cộng tác Odoo.',
  category: 'Quản trị',
  models,
  relations,
  functions,
  messages: {
    vi: {
      'app.title': 'Nhập cộng tác từ Odoo',
      'app.summary': 'Snapshot/delta có checkpoint, identity map và báo cáo đối soát.',
      'app.category': 'Quản trị',
    },
    en: {
      'app.title': 'Odoo collaboration import',
      'app.summary': 'Checkpointed snapshot/delta imports with stable identity maps and reconciliation.',
      'app.category': 'Administration',
    },
  },
})

export { functions } from './functions.ts'
export { importOdooBatch, odooRollbackManifest, previewOdooBatch, stableTargetId } from './operations.ts'
export type {
  OdooImportBatch,
  OdooImportBinding,
  OdooImportCount,
  OdooImportIssue,
  OdooImportReport,
  OdooImportRow,
} from './types.ts'
