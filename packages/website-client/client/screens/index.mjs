import { createPostEditor } from './post-editor.mjs'
import { createTaxonomyScreens } from './taxonomy.mjs'
import { createVisitorCommerceScreens } from './visitor-commerce.mjs'
import { createDomainScreens } from './domains.mjs'
import { createAdapterList, createAdapter } from './adapters.mjs'
import { createVisitorAccount } from './visitor-account.mjs'
import { createSubmissionDetail, createVisitorForm, createVisitorReceipt } from './form-journeys.mjs'
import { createEntryDetails, createPreview, createPublicSite } from './content.mjs'
import { createResourceScreens } from './resources.mjs'
// Core screen table. Keys equal the core route keys in `../routes.mjs`; a test keeps them equal.
import { createEntryList, createPageNew } from './entries.mjs'
import { createBuilder } from './builder.mjs'
import { createOverview } from './overview.mjs'
import { createFormList, createSubmissionList } from './forms.mjs'
import { createSettings } from './settings.mjs'

export const createCoreScreens = (ctx) => ({
  ...createResourceScreens(ctx),
  ...createTaxonomyScreens(ctx),
  ...createVisitorCommerceScreens(ctx),
  ...createDomainScreens(ctx),
  overview: createOverview(ctx),
  'entry-details': createEntryDetails(ctx),
  preview: createPreview(ctx),
  public: createPublicSite(ctx),
  'visitor-account': createVisitorAccount(ctx),
  'visitor-register': createVisitorAccount(ctx, 'register'),
  'visitor-login': createVisitorAccount(ctx, 'login'),
  'visitor-recovery': createVisitorAccount(ctx, 'recovery'),
  pages: createEntryList(ctx, 'page'),
  'page-new': createPageNew(ctx),
  builder: createBuilder(ctx),
  posts: createEntryList(ctx, 'post'),
  'post-new': createPostEditor(ctx, true),
  'post-edit': createPostEditor(ctx),
  forms: createFormList(ctx),
  'submission-detail': createSubmissionDetail(ctx),
  'visitor-form': createVisitorForm(ctx),
  'visitor-receipt': createVisitorReceipt(ctx),
  submissions: createSubmissionList(ctx),
  settings: createSettings(ctx),
  adapters: createAdapterList(ctx),
  adapter: createAdapter(ctx),
  'visitor-table': createAdapter(ctx, 'hospitality'),
  'visitor-contact': createAdapter(ctx, 'crm'),
})
