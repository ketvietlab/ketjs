import { createPostEditor } from './post-editor.tsx'
import { createTaxonomyScreens } from './taxonomy.tsx'
import { createVisitorCommerceScreens } from './visitor-commerce.tsx'
import { createDomainScreens } from './domains.tsx'
import { createAdapterList, createAdapter } from './adapters.tsx'
import { createVisitorAccount } from './visitor-account.tsx'
import { createSubmissionDetail, createVisitorForm, createVisitorReceipt } from './form-journeys.tsx'
import { createEntryDetails, createPreview, createPublicSite } from './content.tsx'
import { createResourceScreens } from './resources.tsx'
// Core screen table. Keys equal the core route keys in `../routes.ts`; a test keeps them equal.
import { createEntryList, createPageNew } from './entries.tsx'
import { createBuilder } from './builder.tsx'
import { createOverview } from './overview.tsx'
import { createFormList, createSubmissionList } from './forms.tsx'
import { createSettings } from './settings.tsx'
import { createCustomerScreens } from './customers.tsx'
import type { Screen, StudioContext } from '../types.ts'

export const createCoreScreens = (ctx: StudioContext): Record<string, Screen> => ({
  ...createResourceScreens(ctx),
  ...createTaxonomyScreens(ctx),
  ...createVisitorCommerceScreens(ctx),
  ...createDomainScreens(ctx),
  ...createCustomerScreens(ctx),
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
