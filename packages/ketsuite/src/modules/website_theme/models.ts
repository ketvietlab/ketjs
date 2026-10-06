import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * The registry of themes one company owns. Bundled themes are not rows: they ship in code, so a fix to
 * one reaches every site with the release instead of a migration per tenant.
 *
 * Only metadata lives here. File bodies are in the tenant's KetJS storage under `storagePrefix`, on
 * whichever driver the deployment runs (a local directory or S3-compatible Object Storage).
 */
export const models: Record<string, ModelDef> = {
  Theme: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      key: 'text',
      tier: 'text',
      title: 'text',
    },
    indexes: { company_key: { fields: ['companyId', 'key'], unique: true } },
  },
  ThemeVersion: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      themeId: 'ref:website_theme.Theme',
      version: 'text',
      /** SHA-256 over every file of the package; the same bytes are the same version. */
      hash: 'text',
      manifest: 'json',
      files: 'json',
      /** Validated KTL source mirrors its hashed package file for synchronous publication snapshots. */
      frameTemplates: 'json?',
      storagePrefix: 'text',
      status: 'text',
      statusReason: 'text?',
      installedAt: 'datetime?',
      installedBy: 'text?',
    },
    indexes: { theme_version: { fields: ['themeId', 'version'], unique: true } },
  },
}
