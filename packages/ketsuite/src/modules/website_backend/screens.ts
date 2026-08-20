import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  framed,
  inline,
  linkButton,
  notice,
  recordActions,
  recordForm,
  section,
  stack,
  surface,
} from '../../ui/index.ts'
import type { FormOption, Frame } from '../../ui/index.ts'

export type SiteRow = {
  id: string
  name: string
  title: string
  defaultLocale: string
  theme: string
  active: boolean
}

export type EntryRow = {
  id: string
  siteId: string
  type: string
  slug: string
  path: string
  title: string
  excerpt?: string | null
  status: string
  updatedAt?: string | null
}

export type EntryDetail = {
  entry: EntryRow
  revision?: { title: string; excerpt?: string | null; layout: unknown; fields: unknown } | null
}

const statusTone = (status: string): 'positive' | 'info' | 'warning' | 'neutral' =>
  status === 'published'
    ? 'positive'
    : status === 'scheduled'
      ? 'info'
      : status === 'trash'
        ? 'warning'
        : 'neutral'

export const sitesScreen = (_: Translator, rows: SiteRow[], frame: Frame, locale = ''): TemplateResult =>
  framed(
    _,
    _('website_backend.sites.title'),
    frame,
    stack([
      inline([
        linkButton({
          label: _('website_backend.action.newSite'),
          href: `/admin/sites/new${locale}`,
          variant: 'primary',
        }),
        linkButton({
          label: _('website_backend.action.content'),
          href: `/admin/content${locale}`,
          variant: 'secondary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('website_backend.sites.empty'), _('website_backend.sites.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            rowHref: (row) => `/admin/sites/${row.id}${locale}`,
            columns: [
              {
                key: 'name',
                label: _('website_backend.field.name'),
                priority: 'primary',
                cell: (row) => row.name,
              },
              {
                key: 'title',
                label: _('website_backend.field.siteTitle'),
                priority: 'primary',
                cell: (row) => row.title,
              },
              {
                key: 'locale',
                label: _('website_backend.field.locale'),
                cell: (row) => code(row.defaultLocale),
              },
              { key: 'theme', label: _('website_backend.field.theme'), cell: (row) => code(row.theme) },
              {
                key: 'state',
                label: _('website_backend.field.status'),
                kind: 'status',
                cell: (row) =>
                  badge(
                    row.active ? _('website_backend.state.active') : _('website_backend.state.inactive'),
                    row.active ? 'positive' : 'neutral',
                  ),
              },
            ],
          }),
    ]),
  )

export const siteFormScreen = (
  _: Translator,
  row: Partial<SiteRow>,
  themes: FormOption[],
  frame: Frame,
  options: { errors?: string[]; locale?: string } = {},
): TemplateResult => {
  const existing = !!row.id
  return framed(
    _,
    existing ? String(row.title ?? row.name) : _('website_backend.sites.newTitle'),
    frame,
    section({
      eyebrow: _('website_backend.sites.eyebrow'),
      title: existing ? String(row.title ?? row.name) : _('website_backend.sites.newTitle'),
      description: _('website_backend.sites.formHint'),
      body: surface({
        body: recordForm({
          action: existing
            ? `/admin/sites/${row.id}${options.locale ?? ''}`
            : `/admin/sites/new${options.locale ?? ''}`,
          fields: [
            { name: 'name', label: _('website_backend.field.name'), value: row.name, required: true },
            { name: 'title', label: _('website_backend.field.siteTitle'), value: row.title, required: true },
            {
              name: 'defaultLocale',
              label: _('website_backend.field.locale'),
              type: 'select',
              value: row.defaultLocale ?? 'vi',
              options: [
                { value: 'vi', label: 'Tiếng Việt' },
                { value: 'en', label: 'English' },
              ],
              required: true,
            },
            {
              name: 'theme',
              label: _('website_backend.field.theme'),
              type: 'select',
              value: row.theme,
              options: themes,
              required: true,
            },
            {
              name: 'active',
              label: _('website_backend.field.active'),
              type: 'checkbox',
              value: row.active ?? true,
              span: 'full',
            },
          ],
          submit: _('website_backend.action.save'),
          submitVariant: 'primary',
          errors: options.errors,
          cancelHref: `/admin/sites${options.locale ?? ''}`,
          cancelLabel: _('website_backend.action.cancel'),
        }),
      }),
    }),
  )
}

export const contentScreen = (
  _: Translator,
  rows: EntryRow[],
  sites: FormOption[],
  siteId: string | null,
  frame: Frame,
  locale = '',
): TemplateResult =>
  framed(
    _,
    _('website_backend.content.title'),
    frame,
    stack([
      surface({
        padding: 'compact',
        body: recordForm({
          action: `/admin/content${locale}`,
          method: 'get',
          layout: 'inline',
          fields: [
            {
              name: 'site',
              label: _('website_backend.field.site'),
              type: 'select',
              value: siteId,
              options: sites,
            },
          ],
          submit: _('website_backend.action.switchSite'),
          submitVariant: 'secondary',
        }),
      }),
      inline([
        linkButton({
          label: _('website_backend.action.newEntry'),
          href: `/admin/content/new?site=${encodeURIComponent(siteId ?? '')}${locale ? `&${locale.slice(1)}` : ''}`,
          variant: 'primary',
        }),
        linkButton({
          label: _('website_backend.action.taxonomies'),
          href: `/admin/taxonomies?site=${encodeURIComponent(siteId ?? '')}${locale ? `&${locale.slice(1)}` : ''}`,
        }),
      ]),
      !siteId
        ? emptyState(_('website_backend.content.noSite'), _('website_backend.content.noSiteHint'))
        : rows.length === 0
          ? emptyState(_('website_backend.content.empty'), _('website_backend.content.emptyHint'))
          : dataTable(_, {
              rows,
              id: (row) => row.id,
              rowHref: (row) => `/admin/content/${row.id}${locale}`,
              columns: [
                {
                  key: 'title',
                  label: _('website_backend.field.title'),
                  priority: 'primary',
                  cell: (row) => row.title,
                },
                {
                  key: 'path',
                  label: _('website_backend.field.path'),
                  kind: 'identifier',
                  cell: (row) => code(row.path),
                },
                { key: 'type', label: _('website_backend.field.type'), cell: (row) => code(row.type) },
                {
                  key: 'status',
                  label: _('website_backend.field.status'),
                  kind: 'status',
                  cell: (row) => badge(_(`website_backend.state.${row.status}`), statusTone(row.status)),
                },
              ],
            }),
    ]),
  )

export const entryFormScreen = (
  _: Translator,
  detail: EntryDetail | null,
  siteId: string,
  types: FormOption[],
  frame: Frame,
  options: { values?: Record<string, string>; errors?: string[]; locale?: string } = {},
): TemplateResult => {
  const entry = detail?.entry
  const revision = detail?.revision
  const values = options.values ?? {}
  const existing = !!entry
  const action = existing
    ? `/admin/content/${entry.id}${options.locale ?? ''}`
    : `/admin/content/new${options.locale ?? ''}`
  const layout =
    values.layout ??
    JSON.stringify(revision?.layout ?? [{ type: 'website.rich_text', settings: { body: '' } }], null, 2)
  const fields = values.fields ?? JSON.stringify(revision?.fields ?? {}, null, 2)
  return framed(
    _,
    existing ? String(entry.title) : _('website_backend.content.newTitle'),
    frame,
    stack([
      ...(existing
        ? [
            inline([
              badge(_(`website_backend.state.${entry.status}`), statusTone(entry.status)),
              linkButton({
                label: _('website_backend.action.revisions'),
                href: `/admin/content/${entry.id}/revisions${options.locale ?? ''}`,
              }),
              linkButton({
                label: _('website_backend.action.preview'),
                href: `/admin/content/${entry.id}/preview${options.locale ?? ''}`,
              }),
            ]),
          ]
        : []),
      section({
        eyebrow: _('website_backend.content.eyebrow'),
        title: existing ? String(entry.title) : _('website_backend.content.newTitle'),
        description: _('website_backend.content.formHint'),
        body: surface({
          body: recordForm({
            action,
            hidden: { siteId },
            fields: [
              {
                name: 'title',
                label: _('website_backend.field.title'),
                value: values.title ?? revision?.title ?? entry?.title,
                required: true,
                span: 'full',
              },
              {
                name: 'slug',
                label: _('website_backend.field.slug'),
                value: values.slug ?? entry?.slug,
                required: true,
              },
              {
                name: 'path',
                label: _('website_backend.field.path'),
                value: values.path ?? entry?.path,
                required: true,
              },
              {
                name: 'type',
                label: _('website_backend.field.type'),
                type: 'select',
                value: values.type ?? entry?.type ?? types[0]?.value,
                options: types,
                required: true,
              },
              {
                name: 'excerpt',
                label: _('website_backend.field.excerpt'),
                type: 'textarea',
                value: values.excerpt ?? revision?.excerpt,
                span: 'full',
              },
              {
                name: 'fields',
                label: _('website_backend.field.fields'),
                type: 'textarea',
                value: fields,
                help: _('website_backend.field.fieldsHint'),
                span: 'full',
              },
              {
                name: 'layout',
                label: _('website_backend.field.layout'),
                type: 'textarea',
                value: layout,
                help: _('website_backend.field.layoutHint'),
                required: true,
                span: 'full',
              },
            ],
            submit: _('website_backend.action.saveDraft'),
            submitVariant: 'primary',
            errors: options.errors,
            cancelHref: `/admin/content?site=${encodeURIComponent(siteId)}${options.locale ? `&${options.locale.slice(1)}` : ''}`,
            cancelLabel: _('website_backend.action.cancel'),
          }),
        }),
      }),
      ...(existing
        ? [
            section({
              title: _('website_backend.publish.title'),
              description: _('website_backend.publish.hint'),
              body: surface({
                body: recordActions({
                  action: `/admin/content/${entry.id}/publish${options.locale ?? ''}`,
                  actions: [
                    { value: 'publish', label: _('website_backend.action.publish'), variant: 'primary' },
                  ],
                }),
              }),
            }),
          ]
        : []),
    ]),
  )
}

export const revisionsScreen = (
  _: Translator,
  entry: EntryRow,
  rows: Array<{ id: string; version: number; kind: string; authorId?: string | null; createdAt: string }>,
  frame: Frame,
  locale = '',
): TemplateResult =>
  framed(
    _,
    _('website_backend.revisions.title'),
    frame,
    stack([
      inline([
        linkButton({
          label: _('website_backend.action.backToEntry'),
          href: `/admin/content/${entry.id}${locale}`,
        }),
      ]),
      rows.length === 0
        ? emptyState(_('website_backend.revisions.empty'), _('website_backend.revisions.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            columns: [
              {
                key: 'version',
                label: _('website_backend.field.version'),
                kind: 'number',
                cell: (row) => String(row.version),
              },
              {
                key: 'kind',
                label: _('website_backend.field.kind'),
                cell: (row) => badge(row.kind, 'neutral'),
              },
              { key: 'author', label: _('website_backend.field.author'), cell: (row) => row.authorId ?? '—' },
              {
                key: 'created',
                label: _('website_backend.field.createdAt'),
                kind: 'date',
                cell: (row) => row.createdAt,
              },
            ],
          }),
    ]),
  )

export const previewScreen = (
  _: Translator,
  entry: EntryRow,
  token: string,
  expiresAt: string,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('website_backend.preview.title'),
    frame,
    stack([
      notice({ tone: 'info', title: entry.title, message: _('website_backend.preview.hint') }),
      surface({
        body: recordForm({
          action: '/admin/content',
          method: 'get',
          fields: [
            {
              name: 'token',
              label: _('website_backend.preview.token'),
              value: token,
              disabled: true,
              span: 'full',
            },
            {
              name: 'expiresAt',
              label: _('website_backend.preview.expires'),
              value: expiresAt,
              disabled: true,
              span: 'full',
            },
          ],
          submit: _('website_backend.action.backToContent'),
          submitVariant: 'secondary',
        }),
      }),
    ]),
  )

export const taxonomyScreen = (
  _: Translator,
  rows: Array<{ id: string; taxonomy: string; name: string; slug: string; parentId?: string | null }>,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('website_backend.taxonomies.title'),
    frame,
    rows.length === 0
      ? emptyState(_('website_backend.taxonomies.empty'), _('website_backend.taxonomies.emptyHint'))
      : dataTable(_, {
          rows,
          id: (row) => row.id,
          columns: [
            {
              key: 'name',
              label: _('website_backend.field.name'),
              priority: 'primary',
              cell: (row) => row.name,
            },
            {
              key: 'taxonomy',
              label: _('website_backend.field.taxonomy'),
              cell: (row) => code(row.taxonomy),
            },
            { key: 'slug', label: _('website_backend.field.slug'), cell: (row) => code(row.slug) },
            { key: 'parent', label: _('website_backend.field.parent'), cell: (row) => row.parentId ?? '—' },
          ],
        }),
  )

export const mediaScreen = (
  _: Translator,
  rows: Array<{
    id: string
    attachmentId: string
    alt?: string | null
    width?: number | null
    height?: number | null
  }>,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('website_backend.media.title'),
    frame,
    rows.length === 0
      ? emptyState(_('website_backend.media.empty'), _('website_backend.media.emptyHint'))
      : dataTable(_, {
          rows,
          id: (row) => row.id,
          columns: [
            {
              key: 'attachment',
              label: _('website_backend.field.attachment'),
              priority: 'primary',
              cell: (row) => code(row.attachmentId),
            },
            { key: 'alt', label: _('website_backend.field.alt'), cell: (row) => row.alt ?? '—' },
            {
              key: 'size',
              label: _('website_backend.field.size'),
              cell: (row) => (row.width && row.height ? `${row.width} × ${row.height}` : '—'),
            },
          ],
        }),
  )

export const menusScreen = (
  _: Translator,
  rows: Array<{ id: string; label: string; href: string; position: number; parentId?: string | null }>,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('website_backend.menus.title'),
    frame,
    rows.length === 0
      ? emptyState(_('website_backend.menus.empty'), _('website_backend.menus.emptyHint'))
      : dataTable(_, {
          rows,
          id: (row) => row.id,
          columns: [
            {
              key: 'label',
              label: _('website_backend.field.label'),
              priority: 'primary',
              cell: (row) => row.label,
            },
            { key: 'href', label: _('website_backend.field.href'), cell: (row) => code(row.href) },
            {
              key: 'position',
              label: _('website_backend.field.position'),
              kind: 'number',
              cell: (row) => String(row.position),
            },
          ],
        }),
  )

export const formsScreen = (
  _: Translator,
  rows: Array<{ id: string; name: string; active: boolean }>,
  siteId: string | null,
  frame: Frame,
  locale = '',
): TemplateResult =>
  framed(
    _,
    _('website_backend.forms.title'),
    frame,
    stack([
      inline([
        linkButton({
          label: _('website_backend.action.newForm'),
          href: `/admin/forms/new?site=${encodeURIComponent(siteId ?? '')}${locale ? `&${locale.slice(1)}` : ''}`,
          variant: 'primary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('website_backend.forms.empty'), _('website_backend.forms.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            rowHref: (row) => `/admin/forms/${row.id}/submissions${locale}`,
            columns: [
              {
                key: 'name',
                label: _('website_backend.field.name'),
                priority: 'primary',
                cell: (row) => row.name,
              },
              {
                key: 'status',
                label: _('website_backend.field.status'),
                cell: (row) =>
                  badge(
                    row.active ? _('website_backend.state.active') : _('website_backend.state.inactive'),
                    row.active ? 'positive' : 'neutral',
                  ),
              },
            ],
          }),
    ]),
  )

export const formCreateScreen = (
  _: Translator,
  siteId: string,
  frame: Frame,
  options: { values?: Record<string, string>; errors?: string[]; locale?: string } = {},
): TemplateResult =>
  framed(
    _,
    _('website_backend.forms.newTitle'),
    frame,
    section({
      title: _('website_backend.forms.newTitle'),
      description: _('website_backend.forms.formHint'),
      body: surface({
        body: recordForm({
          action: `/admin/forms/new${options.locale ?? ''}`,
          hidden: { siteId },
          fields: [
            {
              name: 'name',
              label: _('website_backend.field.name'),
              value: options.values?.name,
              required: true,
            },
            {
              name: 'notifyTo',
              label: _('website_backend.field.notifyTo'),
              type: 'text',
              value: options.values?.notifyTo,
            },
            {
              name: 'successMessage',
              label: _('website_backend.field.successMessage'),
              value: options.values?.successMessage,
              required: true,
              span: 'full',
            },
            {
              name: 'schema',
              label: _('website_backend.field.schema'),
              type: 'textarea',
              value:
                options.values?.schema ??
                JSON.stringify({ fields: [{ name: 'email', type: 'email', required: true }] }, null, 2),
              required: true,
              span: 'full',
            },
          ],
          submit: _('website_backend.action.save'),
          submitVariant: 'primary',
          errors: options.errors,
          cancelHref: `/admin/forms?site=${encodeURIComponent(siteId)}${options.locale ? `&${options.locale.slice(1)}` : ''}`,
          cancelLabel: _('website_backend.action.cancel'),
        }),
      }),
    }),
  )

export const submissionsScreen = (
  _: Translator,
  rows: Array<{ id: string; payload: unknown; consent: boolean; status: string; createdAt: string }>,
  frame: Frame,
): TemplateResult =>
  framed(
    _,
    _('website_backend.submissions.title'),
    frame,
    rows.length === 0
      ? emptyState(_('website_backend.submissions.empty'), _('website_backend.submissions.emptyHint'))
      : dataTable(_, {
          rows,
          id: (row) => row.id,
          columns: [
            {
              key: 'created',
              label: _('website_backend.field.createdAt'),
              kind: 'date',
              priority: 'primary',
              cell: (row) => row.createdAt,
            },
            {
              key: 'payload',
              label: _('website_backend.field.payload'),
              cell: (row) => code(JSON.stringify(row.payload)),
            },
            {
              key: 'consent',
              label: _('website_backend.field.consent'),
              cell: (row) =>
                badge(
                  row.consent ? _('website_backend.state.yes') : _('website_backend.state.no'),
                  row.consent ? 'positive' : 'neutral',
                ),
            },
            {
              key: 'status',
              label: _('website_backend.field.status'),
              cell: (row) => badge(row.status, 'info'),
            },
          ],
        }),
  )
