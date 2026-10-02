import { styleKeys, studioStyleDefaults } from '../../website/studio-style.ts'
import { pageTemplates } from '../../website/studio-content.ts'
import { csvCell, safeFilename } from '../csv.ts'
import { entryProjection } from './context.ts'
import { CUSTOMER_SIGNIN_PATH } from './public.ts'
import type { Route, ServeContext, Row } from '@ketvietlab/ketjs'
type Req = Parameters<Route>[1]
export type Snapshot = {
  sites: Row[]
  site: Row | null
  entries: Row[]
  revisions: Row[]
  publications: Row[]
  domains: Row[]
  sections: unknown
}
const row = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}
const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { code })
}
const themeResource = (site: Row) => ({
  id: String(site.id),
  kind: 'themes',
  title: site.title,
  revisionId: site.styleRevision ?? 'initial',
  ...studioStyleDefaults,
  footer: site.title,
  ...row(site.studioStyle),
})
/** A site has one native navigation, the header, keyed by the site id. */
const menuResource = (site: Row, state: Row) => ({
  id: String(site.id),
  kind: 'menus',
  title: state.title ?? 'Menu chính',
  locale: site.defaultLocale,
  position: 'header',
  state: 'published',
  revisionId: state.revisionId,
  items: state.items ?? [],
  archivable: false,
})
/** The post metadata the Builder's settings panel may send with SEO. */
const postKeys = ['author', 'excerpt', 'category', 'tags', 'cover', 'coverAlt', 'publishedAt']
const capabilities: Record<string, string[]> = {
  'website.content.write': ['website.saveEntry'],
  'website.publish': ['website.publishEntry', 'website.cancelScheduledEntry'],
  'website.site.manage': ['website.saveSite', 'website.saveStudioStyle'],
  'website.form.manage': ['website_form.saveForm', 'website_form.archiveForm'],
  'website.submission.manage': [
    'website_form.readSubmission',
    'website_form.holdSubmission',
    'website_form.exportSubmissions',
    'website_form.retryDelivery',
  ],
  'website.customer.manage': [
    'website.listCustomerAccounts',
    'website.customerAccessForSite',
    'website.disableCustomerAccess',
    'website.enableCustomerAccess',
    'website.resetCustomerPassword',
    'website.setCustomerSelfSignup',
  ],
  // Issuing finds the customer among the company's partners first.
  'website.customer.issue': ['website.issueCustomerAccess', 'partner.listPartners'],
}
/** Optional modules a site can be bound to, by the prefix of their functions. */
const bindingModules: [string, string][] = [
  ['retail', 'website_retail.'],
  ['hospitality', 'website_hospitality.'],
  ['crm', 'crm_website.'],
]
/**
 * The function that opens a receiver's record, by destination. A link the viewer cannot open
 * only leads to a refusal, so the Studio shows it to those who may follow it.
 */
const destinationReaders: Record<string, string> = { crm_website: 'crm.case.get' }
/** What the Studio says when a form is saved without a message of its own. */
const DEFAULT_SUCCESS = 'Cảm ơn bạn. Chúng tôi đã nhận được thông tin.'
const DAY = 24 * 60 * 60 * 1000
/** The fields of a stored schema, in order. */
const schemaFields = (schema: unknown): Row[] => {
  const fields = row(schema).fields
  return Array.isArray(fields) ? fields.map(row) : []
}
/** When a submission's answers are due to be erased, if its form keeps them for a set time. */
const retentionUntil = (form: Row, createdAt: unknown) =>
  form.retentionDays && createdAt
    ? new Date(new Date(String(createdAt)).getTime() + Number(form.retentionDays) * DAY).toISOString()
    : null
/** A submission as the Studio's queue shows it: no answers beyond those classified public. */
const submissionRow = (form: Row, s: Row) => ({
  id: s.id,
  formId: s.formId,
  status: s.held ? 'held' : s.status === 'new' ? 'new' : 'read',
  summary:
    Object.values(row(s.summary))
      .filter((value) => value != null && value !== '')
      .map(String)
      .join(' · ') || '—',
  excerpt: s.id,
  // The form's own notice goes through the mail outbox; the Studio does not follow it per row.
  deliveryState: form.notifyTo ? 'mail' : 'notConfigured',
  retentionUntil: s.held ? null : retentionUntil(form, s.createdAt),
  // Where the request went beyond the Website, and where the receiver says it stands.
  destinationState: s.deliveryState ?? null,
  destinationStatus: s.deliveryStatus ?? null,
  destinationOutcome: s.deliveryOutcome ?? null,
  createdAt: s.createdAt,
})
/** Audit actions as the Studio names them. */
const auditAction: Record<string, string> = {
  hold: 'held',
  read: 'read',
  release: 'release',
  export: 'export',
  purge: 'purge',
  retry: 'retry',
}
/** Whether a layout, at any depth, places this form. */
const placesForm = (nodes: unknown, formId: unknown): boolean =>
  Array.isArray(nodes) &&
  nodes.some((node) => {
    const value = row(node)
    if (value.type === 'website_form.form' && row(value.settings).formId === formId) return true
    return Object.values(row(value.slots)).some((children) => placesForm(children, formId))
  })
/** Pages and posts whose draft or live revision shows the form. */
const formUsage = (formId: unknown, data: Snapshot) => {
  const layouts = new Map(data.revisions.map((r) => [r.id, r.layout]))
  return data.entries
    .filter(
      (e) =>
        !e.trashed &&
        [e.currentRevisionId, e.publishedRevisionId, e.scheduledRevisionId].some(
          (id) => id && placesForm(layouts.get(id), formId),
        ),
    )
    .map((e) => ({ id: e.id, title: e.title, type: e.publishedRevisionId ? 'publication' : 'draft' }))
}
/** A stored form as the Studio's form editor reads it. */
const formResource = (form: Row, versions: Row[], usage: unknown[], destinations: Row[]) => {
  const schema = row(form.schema)
  // Each row needs a stable id for reordering; a form written by another caller may not carry one.
  const fields = (Array.isArray(schema.fields) ? schema.fields : []).map((field: unknown) => {
    const value = row(field)
    return { ...value, id: String(value.id ?? value.name) }
  })
  return {
    id: form.id,
    siteId: form.siteId,
    kind: 'form-editor',
    title: form.name,
    schema: { ...schema, fields },
    recipient: form.notifyTo ?? '',
    successMessage: form.successMessage ?? '',
    consentLabel: form.consentText ?? '',
    spamProtection: 'honeypot',
    active: form.active ? 'yes' : 'no',
    retentionDays: form.retentionDays ?? null,
    // The receivers this deployment composes; none means the choice is not shown at all.
    destination: form.destination ?? '',
    destinations,
    schemaVersion: form.schemaVersion,
    revisionId: String(form.revision ?? 0),
    versions: versions.map((v) => ({
      revisionId: `v${v.version}`,
      title: v.name,
      schema: v.schema,
      createdAt: v.createdAt,
    })),
    usage,
  }
}
const postsNaming = (term: Row, entries: Row[]) =>
  entries.filter(
    (e) =>
      e.type === 'post' &&
      !e.trashed &&
      (e.category === term.id || (Array.isArray(e.tags) && e.tags.includes(term.id))),
  )
/** A stored term as the Studio's taxonomy screens read it. */
const termResource = (term: Row, entries: Row[]) => {
  const type = String(term.taxonomy).replace(/^website\./, '')
  const seo = row(term.seo)
  return {
    id: term.id,
    siteId: term.siteId,
    kind: 'taxonomy',
    title: term.name,
    slug: term.slug,
    path: `/${type}/${term.slug}`,
    description: term.description ?? '',
    descriptionDoc: term.descriptionDoc ?? '',
    parent: term.parentId ?? '',
    taxonomyType: type,
    taxonomyId: term.taxonomy,
    setId: term.taxonomy,
    seoTitle: seo.title ?? '',
    seoDescription: seo.description ?? '',
    canonical: seo.canonical ?? '',
    indexing: seo.indexing === 'noindex' ? 'noindex' : 'index',
    thumbnail: '',
    thumbnailAlt: '',
    cover: '',
    coverAlt: '',
    postCount: postsNaming(term, entries).length,
    revisionId: term.revisionId,
    archived: !!term.archivedAt,
  }
}
export function studioTransport(ctx: ServeContext, url: URL, req: Req) {
  const call = async (name: string, input: Row = {}) => {
    const result = await ctx.call(name, input, url, req, {
      idempotencyKey:
        (await ctx.live(req)).functions[name]?.idempotent &&
        typeof req.headers['idempotency-key'] === 'string'
          ? req.headers['idempotency-key']
          : null,
    })
    const value = row(result)
    if (value.ok === false) {
      const issue = row((value.errors as unknown[])?.[0])
      const key = String(issue.message ?? issue.code ?? '')
      const code = /[Cc]onflict|StaleBase/.test(key)
        ? 'conflict'
        : /[Ff]orbidden/.test(key)
          ? 'forbidden'
          : 'validation'
      fail(code, ctx.translate(ctx.localeOf(url, req))(key) || 'Không thể lưu thay đổi.')
    }
    return result
  }
  const snapshot = async (siteId?: unknown): Promise<Snapshot> => {
    const data = (await call('website_backend.studioContext', { siteId: siteId ?? null })) as Snapshot
    if (siteId && !data.site) fail('notFound', 'Không tìm thấy website.')
    return data
  }
  const menuOf = async (site: Row) =>
    menuResource(site, row(await call('website_menu.menuState', { siteId: site.id })))
  const forEntry = async (id: unknown) => {
    const data = row(await call('website.getEntry', { id }))
    const entry = row(data.entry)
    if (!entry.id) fail('notFound', 'Không tìm thấy nội dung.')
    const dataSet = await snapshot(entry.siteId)
    return { dataSet, entry: dataSet.entries.find((r) => r.id === id)! }
  }
  const publicSite = (site: Row, domains: Row[]) => ({
    ...site,
    name: site.title || site.name,
    host: domains.find((d) => d.primary)?.host ?? '',
    locales: [site.defaultLocale],
    revisionId: String(site.updatedAt ?? site.id),
    timezone: 'Asia/Ho_Chi_Minh',
  })
  const publicationRow = (p: Row) => ({
    ...p,
    label: String(p.preparedAt),
    changeCount: p.entryCount,
    stale: false,
  })
  const termsOf = async (siteId: unknown) =>
    (await call('website.listTaxonomyTerms', { siteId, limit: 100, offset: 0 })) as Row[]
  const termOf = async (input: Row) => {
    const term = row(await call('website.getTaxonomyTerm', { id: input.id }))
    if (!term.id || term.siteId !== input.siteId || term.archivedAt)
      fail('notFound', 'Không tìm thấy chủ đề.')
    return term
  }
  const termDetail = async (term: Row, entries: Row[]) => {
    const children = (await termsOf(term.siteId)).filter((t) => t.parentId === term.id && !t.archivedAt)
    return {
      ...termResource(term, entries),
      usage: [
        ...children.map((child) => ({ id: child.id, title: child.name, type: 'child' })),
        ...postsNaming(term, entries).map((e) => ({ id: e.id, title: e.title, type: 'draft' })),
      ],
    }
  }
  /** The form behind a Studio request, refused unless it belongs to the site the screen is on. */
  const formOf = async (id: unknown, siteId?: unknown) => {
    const history = row(await call('website_form.formHistory', { id }))
    const form = row(history.form)
    if (!form.id || (siteId !== undefined && form.siteId !== siteId))
      fail('notFound', 'Không tìm thấy biểu mẫu.')
    return { form, versions: (history.versions as Row[]) ?? [] }
  }
  const translate = (key: string) => ctx.translate(ctx.localeOf(url, req))(key) || key
  /** Receivers of form submissions, each named by its own module. */
  const destinationOptions = async () =>
    ((await call('website_form.listDestinations', {})) as Row[]).map((d) => ({
      value: String(d.name),
      label: translate(`${String(d.name)}.formDestination`),
    }))
  const formDetail = async (id: unknown, siteId: unknown) => {
    const { form, versions } = await formOf(id, siteId)
    return formResource(
      form,
      versions,
      formUsage(form.id, await snapshot(siteId)),
      await destinationOptions(),
    )
  }
  /** What Settings edits of a site. The revision is the last save, which saveSite does not compare. */
  const siteRecord = (site: Row) => ({
    id: String(site.id),
    title: site.title,
    code: site.name,
    defaultLocale: site.defaultLocale,
    revisionId: String(site.updatedAt ?? site.id),
  })
  const signInUrl = (host: unknown) => (host ? `https://${String(host)}${CUSTOMER_SIGNIN_PATH}` : null)
  /** A sign-in account of this site's customers; one that signs in elsewhere, or nowhere, is not found. */
  const customerOf = async (siteId: unknown, partnerId: unknown) => {
    const access = row(await call('website.customerAccessForSite', { siteId, partnerId }))
    if (!access.account) fail('notFound', 'Không tìm thấy tài khoản đăng nhập.')
    return { ...row(access.account), partnerId: String(partnerId), signInUrl: signInUrl(access.signInHost) }
  }
  const queries: Record<string, (input: Row) => Promise<unknown>> = {
    'website_studio.bootstrap': async (input) => {
      const data = await snapshot(input.site)
      const identity = await ctx.requestIdentityOf(url, req)
      const allowed: string[] = []
      for (const [key, functions] of Object.entries(capabilities)) {
        if ((await Promise.all(functions.map((fn) => ctx.allows(fn, url, req)))).every(Boolean))
          allowed.push(key)
      }
      return {
        actor: { id: identity?.userId, name: identity?.userId, role: '', capabilities: allowed },
        site: data.site ? publicSite(data.site, data.domains) : null,
        sites: data.sites.map((s) => ({
          id: s.id,
          name: s.title || s.name,
          host: s.id === data.site?.id ? (data.domains.find((d) => d.primary)?.host ?? '') : '',
        })),
        offer: null,
        home: '/admin',
      }
    },
    'website.listEntries': async (input) => {
      const data = await snapshot(input.siteId)
      const search = String(input.search ?? '').toLocaleLowerCase('vi')
      return {
        rows: data.entries.filter(
          (e) =>
            e.type === input.type &&
            (input.status === 'trash' ? e.state === 'trash' : e.state !== 'trash') &&
            (!input.status || input.status === 'all' || e.state === input.status) &&
            (!search || `${e.title} ${e.path}`.toLocaleLowerCase('vi').includes(search)),
        ),
      }
    },
    'website.getEntry': async (input) => {
      const { dataSet, entry } = await forEntry(input.id)
      return { entry, sections: dataSet.sections }
    },
    'website_studio.overview': async (input) => {
      const data = await snapshot(input.siteId)
      const entries = data.entries.filter((e) => e.state !== 'trash')
      const queue = entries.filter((e) => e.state !== 'published')
      const active = data.publications.find((p) => p.id === data.site?.activePublicationId)
      // Unopened submissions across the site's forms, for whoever may see the queue at all.
      let newSubmissions = 0
      const submissions: Row[] = []
      if (await ctx.allows('website_form.listSubmissions', url, req))
        for (const form of (await call('website_form.listForms', { siteId: data.site!.id })) as Row[]) {
          const filter = { formId: form.id, status: 'new', held: false }
          newSubmissions += Number(row(await call('website_form.countSubmissions', filter)).count ?? 0)
          const rows = (await call('website_form.listSubmissions', { ...filter, limit: 5 })) as Row[]
          submissions.push(...rows.map((s) => ({ ...submissionRow(form, s), formTitle: form.name })))
        }
      return {
        counts: {
          pages: entries.filter((e) => e.type === 'page').length,
          changed: queue.length,
          newSubmissions,
          issues: 0,
        },
        queue,
        live: active ? publicationRow(active) : null,
        submissions: submissions
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 5),
        blockers: [],
      }
    },
    'website_form.listForms': async (input) => {
      const data = await snapshot(input.siteId)
      const forms = (await call('website_form.listForms', { siteId: data.site!.id })) as Row[]
      const count = async (formId: unknown, filter: Row) =>
        Number(row(await call('website_form.countSubmissions', { formId, ...filter })).count ?? 0)
      return {
        rows: await Promise.all(
          forms.map(async (form) => {
            const latest = (await call('website_form.listSubmissions', {
              formId: form.id,
              limit: 1,
              offset: 0,
            })) as Row[]
            return {
              id: form.id,
              title: form.name,
              active: form.active === true,
              newCount: await count(form.id, { status: 'new', held: false }),
              total: await count(form.id, {}),
              lastAt: latest[0]?.createdAt ?? null,
            }
          }),
        ),
      }
    },
    'website_form.listSubmissions': async (input) => {
      const { form } = await formOf(input.formId)
      const filter =
        input.status === 'held'
          ? { held: true }
          : input.status === 'new'
            ? { status: 'new', held: false }
            : {}
      const rows = (await call('website_form.listSubmissions', {
        formId: form.id,
        ...filter,
        limit: input.limit ?? 50,
        offset: input.offset ?? 0,
      })) as Row[]
      const total = row(await call('website_form.countSubmissions', { formId: form.id, ...filter })).count
      return { rows: rows.map((s) => submissionRow(form, s)), total: Number(total ?? 0) }
    },
    'website_form.readSubmission': async (input) => {
      const found = row(await call('website_form.readSubmission', { id: input.id, reason: 'studio' }))
      if (!found.id) fail('notFound', 'Không tìm thấy bài gửi.')
      return { id: found.id, fields: row(found.payload) }
    },
    'website_form.exportSubmissions': async (input) => {
      const { form } = await formOf(input.formId)
      const fields = schemaFields(form.schema)
      const result = row(
        await call('website_form.exportSubmissions', {
          formId: form.id,
          fields: fields.map((f) => f.name),
          reason: 'studio',
        }),
      )
      const header = ['Mã', 'Nhận lúc', 'Trạng thái', ...fields.map((f) => String(f.label || f.name))]
      const lines = ((result.rows as Row[]) ?? []).map((r) => [
        r._id,
        r._createdAt,
        r._status,
        ...fields.map((f) => r[String(f.name)]),
      ])
      const stem = String(form.name)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
      return {
        filename: `${safeFilename(stem)}-${new Date().toISOString().slice(0, 10)}.csv`,
        // The byte-order mark is what makes a spreadsheet read the file as UTF-8.
        content: `\ufeff${[header, ...lines].map((cells) => cells.map(csvCell).join(',')).join('\r\n')}`,
        capped: result.capped === true,
      }
    },
    'website_studio.submissionDetail': async (input) => {
      const found = row(
        await call('website_form.readSubmission', { id: input.id, reason: 'studio', siteId: input.siteId }),
      )
      if (!found.id) fail('notFound', 'Không tìm thấy bài gửi.')
      const { form, versions } = await formOf(found.formId, input.siteId)
      // The labels the visitor read, from the version they answered, not today's wording.
      const version = Number(found.schemaVersion ?? 1)
      const asked = versions.find((v) => v.version === version)?.schema ?? form.schema
      const audit = (await call('website_form.listSubmissionAudit', {
        formId: form.id,
        submissionId: found.id,
      })) as Row[]
      const reader = destinationReaders[String(found.destination)]
      const mayOpen = !reader || (await ctx.allows(reader, url, req))
      return {
        form: { id: form.id, title: form.name },
        submission: {
          id: found.id,
          fields: row(found.payload),
          receipt: found.id,
          formRevisionId: `v${version}`,
          consentVersion: found.consentText ?? null,
          retentionUntil: found.holdReason ? null : retentionUntil(form, found.createdAt),
          delivery: null,
          destination: found.destination
            ? {
                name: found.destination,
                title: translate(`${String(found.destination)}.formDestination`),
                state: found.deliveryState ?? 'pending',
                status: found.deliveryStatus ?? null,
                outcome: found.deliveryOutcome ?? null,
                href: mayOpen ? (found.deliveryHref ?? null) : null,
                attempts: Number(found.deliveryAttempts ?? 0),
                error: found.deliveryError ? translate(String(found.deliveryError)) : null,
                deliveredAt: found.deliveredAt ?? null,
                syncedAt: found.deliverySyncedAt ?? null,
              }
            : null,
          audit: [
            ...audit.map((a) => ({ at: a.occurredAt, action: auditAction[String(a.action)] ?? a.action })),
            { at: found.createdAt, action: 'received' },
          ],
        },
        labels: Object.fromEntries(schemaFields(asked).map((f) => [f.name, f.label || f.name])),
      }
    },
    'website_form.getForm': async (input) => {
      const { form } = await formOf(input.id)
      return {
        id: form.id,
        siteId: form.siteId,
        title: form.name,
        active: form.active === true,
        retentionDays: form.retentionDays ?? null,
      }
    },
    // The Studio preview of a form: the saved schema, exactly as a visitor gets it.
    'website_studio.visitorForm': async (input) => {
      const { form } = await formOf(input.id, input.siteId)
      if (form.active !== true) fail('validation', 'Biểu mẫu đang đóng.')
      return {
        form: {
          id: form.id,
          title: form.name,
          consentLabel: form.consentText ?? '',
          successMessage: form.successMessage || DEFAULT_SUCCESS,
          spamProtection: 'honeypot',
        },
        fields: schemaFields(form.schema).map((field) => ({
          name: field.name,
          label: field.label || field.name,
          type: field.type ?? 'text',
          required: field.required === true,
          maxLength: field.maxLength ?? null,
        })),
      }
    },
    // Sending from the preview runs every check a visitor's post meets and stores nothing: no
    // submission, no mail, no retention clock. Visitors post on the site itself (`/forms/{id}`).
    'website_studio.submitVisitorForm': async (input) => {
      const { form } = await formOf(input.formId, input.siteId)
      const fields = schemaFields(form.schema)
      const answers = row(input.fields)
      const payload: Row = {}
      for (const field of fields) {
        const value = answers[String(field.name)]
        if (field.type === 'checkbox')
          payload[String(field.name)] = value === true || /^(true|on|yes|1)$/i.test(String(value ?? ''))
        else if (typeof value === 'string' && value !== '') payload[String(field.name)] = value
      }
      const result = row(
        await ctx.call(
          'website_form.validateSubmission',
          { formId: form.id, payload, consent: input.consent === true },
          url,
          req,
        ),
      )
      if (result.ok === false) {
        const _ = ctx.translate(ctx.localeOf(url, req))
        const labelOf = (name: unknown) =>
          name === 'consent'
            ? 'Đồng ý'
            : String(fields.find((field) => field.name === name)?.label || name || '')
        fail(
          'validation',
          ((result.errors as Row[]) ?? [])
            .map((error) => {
              const message = _(String(error.message ?? '')) || String(error.message ?? '')
              return error.field && error.field !== 'formId' ? `${labelOf(error.field)}: ${message}` : message
            })
            .join(' · ') || 'Không thể gửi biểu mẫu.',
        )
      }
      return { preview: true }
    },
    'website_studio.submissionReceipt': async (input) => {
      const receipt = row(await ctx.call('website_form.submissionReceipt', { id: input.id }, url, req))
      if (!receipt.id || receipt.siteId !== input.siteId)
        fail('notFound', 'Không tìm thấy biên nhận tại website này.')
      return { receipt: receipt.id, createdAt: receipt.createdAt, state: 'received' }
    },
    'website_studio.entryHistory': async (input) => {
      const { dataSet, entry } = await forEntry(input.id)
      // Builder and visitors read the same navigation; a role without it still edits the page.
      const menus = (await ctx.allows('website_menu.menuState', url, req))
        ? [await menuOf(dataSet.site!)]
        : []
      return {
        entry,
        resources: [themeResource(dataSet.site!), ...menus],
        liveRevisionId: entry.publishedRevisionId,
        revisions: dataSet.revisions
          .filter((r) => r.entryId === entry.id)
          .sort((a, b) => Number(b.version) - Number(a.version))
          .map((r) => ({
            ...entryProjection(entry, r, String(dataSet.site!.defaultLocale)),
            title: r.title,
            excerpt: r.excerpt,
            id: entry.id,
            revisionId: r.id,
            updatedAt: r.createdAt,
            updatedBy: r.authorId ?? '—',
          })),
      }
    },
    'website_studio.getResource': async (input) => {
      if (input.kind === 'form-editor') return formDetail(input.id, input.siteId)
      const data = await snapshot(input.siteId)
      if (input.kind === 'taxonomy') return termDetail(await termOf(input), data.entries)
      if (input.kind === 'menus') {
        if (input.id !== data.site!.id) return fail('notFound', 'Không tìm thấy menu.')
        // A report, not a refusal: `ok: false` here means dangling links, so it skips call's error mapping.
        const preflight = row(
          await ctx.call('website_menu.preflightMenu', { siteId: data.site!.id }, url, req, {
            idempotencyKey: null,
          }),
        )
        const drafts = new Set(data.entries.filter((e) => e.state === 'draft').map((e) => e.path))
        return {
          ...(await menuOf(data.site!)),
          warnings: ((preflight.dangling as Row[] | undefined) ?? []).map((item) => ({
            target: item.href,
            state: drafts.has(item.href) ? 'draft' : 'missing',
          })),
        }
      }
      if (input.kind !== 'themes' || input.id !== data.site!.id)
        return fail('notFound', 'Không tìm thấy giao diện.')
      return {
        ...themeResource(data.site!),
        affected: data.entries.map((e) => ({ id: e.id, title: e.title })),
        usage: data.entries.length,
      }
    },
    'website_studio.saveResource': async (input) => {
      if (input.kind === 'form-editor') {
        const data = await snapshot(input.siteId)
        const values = row(input.values)
        const existing = row(row(await call('website_form.formHistory', { id: input.id })).form)
        if (existing.id && existing.siteId !== data.site!.id) fail('notFound', 'Không tìm thấy biểu mẫu.')
        // A challenge needs a provider this system does not have; storing the choice would promise one.
        if ((values.spamProtection ?? 'honeypot') !== 'honeypot')
          fail('validation', 'Hệ thống hiện chỉ chống spam bằng trường ẩn; chưa hỗ trợ thử thách.')
        const expected = input.expectedRevisionId == null ? null : Number(input.expectedRevisionId)
        if (expected !== null && !Number.isInteger(expected))
          fail('conflict', 'Dữ liệu đã thay đổi. Tải lại trước khi lưu.')
        await call('website_form.saveForm', {
          id: input.id,
          siteId: data.site!.id,
          name: String(values.title ?? '').trim(),
          schema: values.schema,
          consentText: String(values.consentLabel ?? '').trim() || null,
          successMessage: String(values.successMessage ?? '').trim() || DEFAULT_SUCCESS,
          notifyTo: String(values.recipient ?? '').trim() || null,
          active: values.active !== 'no',
          // Absent when the deployment offers no receiver, so a save never clears one set elsewhere.
          ...(values.destination === undefined
            ? {}
            : { destination: String(values.destination ?? '').trim() || null }),
          // Only answers the editor classified public may show in the queue without opening a row.
          summaryFields: schemaFields(values.schema)
            .filter((f) => f.classification === 'public')
            .map((f) => f.name),
          expectedRevision: expected,
        })
        return formDetail(input.id, data.site!.id)
      }
      if (input.kind === 'taxonomy') {
        const data = await snapshot(input.siteId)
        const values = row(input.values)
        const type = String(values.taxonomyType ?? '')
        if (!['category', 'tag'].includes(type)) fail('validation', 'Chọn chuyên mục hoặc thẻ.')
        const existing = row(await call('website.getTaxonomyTerm', { id: input.id }))
        if (existing.id && existing.siteId !== data.site!.id) fail('notFound', 'Không tìm thấy chủ đề.')
        if (existing.id && existing.taxonomy !== `website.${type}`)
          fail('validation', 'Không đổi chuyên mục thành thẻ hoặc ngược lại.')
        // Images for terms need their own storage owner; until then a value here would be
        // stored and never shown, so it is refused rather than dropped.
        if (['thumbnail', 'cover'].some((key) => String(values[key] ?? '').trim()))
          fail('validation', 'Ảnh của chuyên mục và thẻ chưa được hỗ trợ trên hệ thống này.')
        await call('website.saveTerm', {
          id: input.id,
          siteId: data.site!.id,
          taxonomy: `website.${type}`,
          slug: String(values.slug ?? '').trim(),
          name: String(values.title ?? '').trim(),
          parentId: type === 'category' && values.parent ? values.parent : null,
          descriptionDoc: values.descriptionDoc ? String(values.descriptionDoc) : null,
          description: values.descriptionDoc ? null : String(values.description ?? '').trim() || null,
          seo: {
            title: String(values.seoTitle ?? ''),
            description: String(values.seoDescription ?? ''),
            canonical: String(values.canonical ?? ''),
            indexing: values.indexing === 'noindex' ? 'noindex' : 'index',
          },
          expectedRevisionId: input.expectedRevisionId ?? null,
        })
        return termDetail(await termOf(input), (await snapshot(input.siteId)).entries)
      }
      if (input.kind === 'menus') {
        const data = await snapshot(input.siteId)
        if (input.id !== data.site!.id) return fail('notFound', 'Không tìm thấy menu.')
        const values = row(input.values)
        if (
          (values.position ?? 'header') !== 'header' ||
          (values.locale ?? data.site!.defaultLocale) !== data.site!.defaultLocale
        )
          return fail('validation', 'Website hiện chỉ có menu đầu trang theo ngôn ngữ mặc định.')
        await call('website_menu.saveMenu', {
          siteId: data.site!.id,
          expectedRevisionId: input.expectedRevisionId,
          title: values.title ?? null,
          items: values.items,
        })
        return menuOf(data.site!)
      }
      if (input.kind === 'sites') {
        const site = (await snapshot(input.siteId)).site!
        if (input.id !== site.id) return fail('notFound', 'Không tìm thấy website.')
        if (input.expectedRevisionId !== siteRecord(site).revisionId)
          fail('conflict', 'Dữ liệu đã thay đổi. Tải lại trước khi lưu.')
        const values = row(input.values)
        await call('website.saveSite', {
          id: site.id,
          name: String(values.code ?? site.name).trim(),
          title: String(values.title ?? site.title).trim(),
          defaultLocale: String(values.defaultLocale || site.defaultLocale),
          theme: site.theme,
          tokens: site.tokens ?? null,
          siteGroup: site.siteGroup ?? null,
          active: site.active,
        })
        return siteRecord((await snapshot(input.siteId)).site!)
      }
      if (input.kind !== 'themes')
        return fail('unavailable', 'Chức năng này chưa được kết nối với dữ liệu hệ thống.')
      const data = await snapshot(input.siteId)
      if (input.id !== data.site!.id) return fail('notFound', 'Không tìm thấy giao diện.')
      const values = Object.fromEntries(
        styleKeys
          .filter((key) => row(input.values)[key] !== undefined)
          .map((key) => [key, row(input.values)[key]]),
      )
      await call('website.saveStudioStyle', {
        siteId: input.siteId,
        expectedRevisionId: input.expectedRevisionId,
        values,
      })
      return themeResource((await snapshot(input.siteId)).site!)
    },
    'website_studio.listResources': async (input) => {
      const data = await snapshot(input.siteId)
      if (input.kind === 'templates') return { rows: pageTemplates }
      if (input.kind === 'themes') return { rows: [themeResource(data.site!)] }
      if (input.kind === 'menus') return { rows: [await menuOf(data.site!)], creatable: false }
      if (input.kind === 'domains')
        return {
          rows: data.domains.map((d) => ({
            ...d,
            title: d.host,
            role: d.primary ? 'primary' : 'redirect',
            state: d.verifiedAt ? 'verified' : 'pending',
          })),
        }
      if (input.kind === 'sites') return { rows: data.sites.map((s) => publicSite(s, data.domains)) }
      if (input.kind === 'form-editor') {
        const forms = (await call('website_form.listForms', { siteId: data.site!.id })) as Row[]
        return { rows: forms.map((form) => formResource(form, [], [], [])) }
      }
      if (input.kind === 'taxonomy' || input.kind === 'taxonomy-sets') {
        const terms = await termsOf(input.siteId)
        return { rows: terms.filter((t) => !t.archivedAt).map((t) => termResource(t, data.entries)) }
      }
      fail('unavailable', 'Chức năng này chưa được kết nối với dữ liệu hệ thống.')
    },
    'website_studio.preview': async (input) => {
      const { dataSet, entry } = await forEntry(input.id)
      if (input.siteId && input.siteId !== entry.siteId) fail('notFound', 'Không tìm thấy nội dung.')
      let revisionId = input.revisionId ?? entry.revisionId
      let preview: Row | null = null
      if (input.token) {
        const link = row(await call('website.previewLink', { token: input.token }))
        if (link.entryId !== entry.id || link.active !== true)
          fail('expired', 'Liên kết xem trước đã hết hạn hoặc bị thu hồi.')
        const host = publicSite(dataSet.site!, dataSet.domains).host
        revisionId = link.revisionId
        preview = {
          token: input.token,
          audience: link.audience,
          expiresAt: link.expiresAt,
          // Staff open it here; anyone else needs the site's own address, where no ERP login is asked.
          url:
            link.audience === 'link' && host
              ? `${url.hostname === host ? url.origin : `${url.protocol}//${host}`}/_ket/preview?token=${encodeURIComponent(String(input.token))}`
              : null,
        }
      }
      const revision = dataSet.revisions.find((r) => r.id === revisionId && r.entryId === entry.id)
      if (!revision) return fail('notFound', 'Không tìm thấy phiên bản.')
      return {
        preview,
        entry: {
          ...entryProjection(entry, revision, String(dataSet.site!.defaultLocale)),
          title: revision.title,
          revisionId: revision.id,
        },
        theme: themeResource(dataSet.site!),
        site: publicSite(dataSet.site!, dataSet.domains),
      }
    },
    'website_studio.createPreview': async (input) => {
      const { entry } = await forEntry(input.id)
      if (entry.siteId !== input.siteId) fail('notFound', 'Không tìm thấy nội dung.')
      const minutes = input.minutes
      if (
        (input.audience !== 'staff' && input.audience !== 'link') ||
        !Number.isInteger(minutes) ||
        (minutes as number) < 5 ||
        (minutes as number) > 1440
      )
        fail('validation', 'Chọn đối tượng và hạn xem trước từ 5 phút đến 24 giờ.')
      const minted = row(
        await call('website.createPreviewToken', {
          entryId: entry.id,
          revisionId: input.revisionId ?? entry.revisionId,
          audience: input.audience,
          ttlSeconds: (minutes as number) * 60,
        }),
      )
      return { id: entry.id, token: minted.token, audience: input.audience, expiresAt: minted.expiresAt }
    },
    'website_studio.revokePreview': async (input) => {
      const link = row(await call('website.previewLink', { token: input.token }))
      if (!link.entryId || link.siteId !== input.siteId) fail('notFound', 'Không tìm thấy liên kết.')
      await call('website.revokePreviewTokens', { entryId: link.entryId, token: input.token })
      return { revoked: true }
    },
    'website_studio.archiveResource': async (input) => {
      if (input.kind === 'form-editor') {
        const { form } = await formOf(input.id, input.siteId)
        if (!input.confirmed) fail('validation', 'Xác nhận lưu trữ trước khi tiếp tục.')
        // A page still showing the form would keep a box that no longer accepts anything.
        const usage = formUsage(form.id, await snapshot(input.siteId))
        if (usage.length) fail('validation', `Đang được dùng tại: ${usage.map((u) => u.title).join(', ')}.`)
        const expected = Number(input.expectedRevisionId)
        if (!Number.isInteger(expected)) fail('conflict', 'Dữ liệu đã thay đổi. Tải lại trước khi lưu trữ.')
        await call('website_form.archiveForm', { id: form.id, expectedRevision: expected })
        return { ...formResource(form, [], [], []), active: 'no', archived: true }
      }
      if (input.kind !== 'taxonomy')
        return fail('unavailable', 'Chức năng này chưa được kết nối với dữ liệu hệ thống.')
      const term = await termOf(input)
      if (!input.confirmed) fail('validation', 'Xác nhận lưu trữ trước khi tiếp tục.')
      // Called directly: a refusal here carries where the term is used, which the editor needs.
      const result = row(
        await ctx.call(
          'website.archiveTerm',
          { id: term.id, expectedRevisionId: input.expectedRevisionId ?? '' },
          url,
          req,
          { idempotencyKey: null },
        ),
      )
      const usage = (result.usage as Row[] | undefined) ?? []
      if (usage.length) fail('validation', `Đang được dùng tại: ${usage.map((u) => u.title).join(', ')}.`)
      if (result.ok === false) {
        const key = String(row((result.errors as unknown[])?.[0]).message ?? '')
        fail(
          /[Cc]onflict/.test(key) ? 'conflict' : /[Ff]orbidden/.test(key) ? 'forbidden' : 'validation',
          ctx.translate(ctx.localeOf(url, req))(key) || 'Không thể lưu trữ.',
        )
      }
      return {
        ...termResource({ ...term, archivedAt: true, revisionId: result.revisionId }, []),
        archived: true,
      }
    },
    'website_studio.savePageSettings': async (input) => {
      const { entry } = await forEntry(input.id)
      if (entry.siteId !== input.siteId) fail('notFound', 'Không tìm thấy nội dung.')
      // The Builder's settings panel edits a post's metadata beside its SEO; dropping it here
      // answered the save as done and kept the old author, cover and tags.
      const post = entry.type === 'post' ? row(input.post) : {}
      return queries['website.saveEntry']!({
        ...entry,
        ...Object.fromEntries(postKeys.filter((key) => key in post).map((key) => [key, post[key]])),
        title: input.title,
        path: input.path,
        seo: input.seo,
        expectedRevisionId: input.expectedRevisionId,
      })
    },
    'website_studio.restoreEntry': async (input) => {
      const { entry } = await forEntry(input.id)
      if (entry.siteId !== input.siteId) fail('notFound', 'Không tìm thấy nội dung.')
      if (!input.expectedRevisionId) fail('conflict', 'Cần phiên bản đang sửa.')
      return call('website.restoreRevision', {
        entryId: input.id,
        revisionId: input.revisionId,
        expectedRevisionId: input.expectedRevisionId,
      })
    },
    'website_studio.setEntryArchived': async (input) => {
      const { entry } = await forEntry(input.id)
      if (entry.siteId !== input.siteId) fail('notFound', 'Không tìm thấy nội dung.')
      if (!input.expectedRevisionId || typeof input.archived !== 'boolean')
        fail('validation', 'Thông tin không hợp lệ.')
      return call(input.archived ? 'website.trashEntry' : 'website.untrashEntry', {
        id: input.id,
        expectedRevisionId: input.expectedRevisionId,
      })
    },
    'website_studio.siteReadiness': async (input) => {
      const data = await snapshot(input.siteId)
      const site = data.site!
      const host = data.domains.find((d) => d.primary)?.host ?? data.domains[0]?.host
      const functions = Object.keys((await ctx.live(req)).functions)
      // How the site takes customer accounts is shown to those who look after them.
      const customers = (await ctx.allows('website.listCustomerAccounts', url, req))
        ? row(await call('website.listCustomerAccounts', { siteId: site.id, limit: 1 }))
        : null
      const realm = row(customers?.realm)
      return {
        site: siteRecord(site),
        publicUrl: host ? `https://${String(host)}` : '',
        bindings: bindingModules
          .filter(([, prefix]) => functions.some((name) => name.startsWith(prefix)))
          .map(([key]) => key),
        blockers: [],
        customers: customers
          ? {
              available: !!realm.id,
              selfSignup: realm.selfSignup === true,
              signInUrl: signInUrl(realm.signInHost),
              total: Number(customers.total ?? 0),
            }
          : null,
      }
    },
    'website_studio.saveCustomerSettings': async (input) => {
      const data = await snapshot(input.siteId)
      if (typeof input.selfSignup !== 'boolean') fail('validation', 'Chọn có cho khách tự đăng ký hay không.')
      await call('website.setCustomerSelfSignup', { siteId: data.site!.id, open: input.selfSignup })
      return { selfSignup: input.selfSignup }
    },
    'website_studio.customers': async (input) => {
      const data = await snapshot(input.siteId)
      const list = row(
        await call('website.listCustomerAccounts', {
          siteId: data.site!.id,
          search: String(input.search ?? '').trim() || null,
          status: ['active', 'disabled'].includes(String(input.status)) ? input.status : null,
          limit: 50,
          offset: Math.max(Number(input.offset ?? 0) || 0, 0),
        }),
      )
      const realm = row(list.realm)
      return {
        available: !!realm.id,
        selfSignup: realm.selfSignup === true,
        signInUrl: signInUrl(realm.signInHost),
        rows: list.rows ?? [],
        total: Number(list.total ?? 0),
      }
    },
    'website_studio.customer': async (input) => {
      const data = await snapshot(input.siteId)
      return customerOf(data.site!.id, input.partnerId)
    },
    'website_studio.customerCommand': async (input) => {
      const data = await snapshot(input.siteId)
      // The account is checked against this site first: the functions below take a partner alone.
      await customerOf(data.site!.id, input.partnerId)
      const partnerId = String(input.partnerId)
      let password: unknown = null
      if (input.action === 'disable') await call('website.disableCustomerAccess', { partnerId })
      else if (input.action === 'enable') await call('website.enableCustomerAccess', { partnerId })
      else if (input.action === 'reset')
        password = row(
          await call('website.resetCustomerPassword', {
            partnerId,
            password: String(input.password ?? '') || null,
          }),
        ).password
      else fail('validation', 'Thao tác không hợp lệ.')
      return { account: await customerOf(data.site!.id, partnerId), password: password ?? null }
    },
    'website_studio.customerCandidates': async (input) => {
      const data = await snapshot(input.siteId)
      const search = String(input.search ?? '').trim()
      if (search.length < 2) return { rows: [] }
      const partners = (await call('partner.listPartners', { search, limit: 10 })) as Row[]
      const rows = []
      for (const partner of partners) {
        const access = row(
          await call('website.customerAccessForSite', { siteId: data.site!.id, partnerId: partner.id }),
        )
        rows.push({
          id: String(partner.id),
          name: String(partner.name),
          // Partners keep E.164; staff and customers write the national 0… form.
          phone: typeof partner.phone === 'string' ? partner.phone.replace(/^\+84(?=\d{9,10}$)/, '0') : null,
          email: partner.email ?? null,
          account: access.account ? String(row(access.account).status) : null,
        })
      }
      return { rows }
    },
    'website_studio.issueCustomer': async (input) => {
      const data = await snapshot(input.siteId)
      const values = row(input.values)
      // Issuing again would reset the password unasked; that is the account's own reset action.
      const held = row(
        await call('website.customerAccessForSite', { siteId: data.site!.id, partnerId: input.partnerId }),
      )
      if (held.account) fail('conflict', 'Khách này đã có tài khoản đăng nhập.')
      const issued = row(
        await call('website.issueCustomerAccess', {
          siteId: data.site!.id,
          partnerId: String(input.partnerId ?? ''),
          displayName: String(values.displayName ?? '').trim() || null,
          phone: String(values.phone ?? '').trim() || null,
          email: String(values.email ?? '').trim() || null,
          password: String(values.password ?? '') || null,
        }),
      )
      return {
        account: await customerOf(data.site!.id, input.partnerId),
        password: issued.password ?? null,
        created: issued.created === true,
      }
    },
    'website.saveEntry': async (input) => {
      if (!(await ctx.allows('website.saveEntry', url, req)))
        fail('forbidden', 'Bạn không có quyền sửa nội dung.')
      const data = await snapshot(input.siteId)
      const existing = data.entries.find((e) => e.id === input.id)
      const fields = { ...row(existing?.fields), ...row(input.fields) }
      const type = String(input.type).startsWith('website.') ? String(input.type) : `website.${input.type}`
      const definition = (await ctx.live(req)).contentTypes[type]
      for (const key of Object.keys(definition?.fields ?? {}))
        if (input[key] !== undefined) fields[key] = input[key]
      if (fields.bodyDoc != null) delete fields.bodyText
      return call('website.saveEntry', {
        id: input.id,
        siteId: input.siteId,
        type,
        slug:
          String(input.slug ?? input.path)
            .split('/')
            .filter(Boolean)
            .at(-1) || 'home',
        path: input.path,
        title: input.title,
        excerpt: input.excerpt ?? null,
        layout: input.layout,
        fields,
        expectedRevisionId: input.expectedRevisionId ?? null,
      })
    },
  }
  for (const name of [
    'website.publishEntry',
    'website.cancelScheduledEntry',
    'website.diffRevisions',
    'website.createPreviewToken',
    'website_form.holdSubmission',
    'website_form.retryDelivery',
  ])
    queries[name] = (input) => call(name, input)
  return async (name: string, input: Row) => {
    if (!Object.hasOwn(queries, name)) fail('notFound', 'Thao tác không được hỗ trợ.')
    return queries[name]!(input)
  }
}
