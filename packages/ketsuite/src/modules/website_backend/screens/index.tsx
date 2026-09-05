import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  RecordScreen,
  inline,
  linkButton,
  Notice,
  RecordActions,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'
import { FormScreenFrame, ListScreenFrame } from './page-frame.tsx'

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
  revision?: { id: string; title: string; excerpt?: string | null; layout: unknown; fields: unknown } | null
}

export type EntryKind = {
  basePath: '/admin/website/pages' | '/admin/website/posts'
  titleKey: 'pages' | 'posts'
}

export type TaxonomyRow = {
  id: string
  siteId: string
  taxonomy: string
  name: string
  slug: string
  description?: string | null
  parentId?: string | null
}

export type MediaRow = {
  id: string
  siteId: string
  attachmentId: string
  alt?: string | null
  caption?: string | null
  width?: number | null
  height?: number | null
}

export type MenuRow = {
  id: string
  siteId: string
  label: string
  href: string
  position: number
  parentId?: string | null
}

const statusTone = (status: string): 'positive' | 'info' | 'warning' | 'neutral' =>
  status === 'published'
    ? 'positive'
    : status === 'scheduled'
      ? 'info'
      : status === 'trash'
        ? 'warning'
        : 'neutral'

export const sitesScreen = (_: Translator, rows: SiteRow[], frame: Frame, locale = ''): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('website_backend.sites.title')}
    frame={frame}
    body={stack([
      inline([
        linkButton({
          label: _('website_backend.action.newSite'),
          href: `/admin/website/sites/new${locale}`,
          variant: 'primary',
        }),
        linkButton({
          label: _('website_backend.action.pages'),
          href: `/admin/website/pages${locale}`,
          variant: 'secondary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('website_backend.sites.empty'), _('website_backend.sites.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            rowHref: (row) => `/admin/website/sites/${row.id}${locale}`,
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
    ])}
  />
)

export const siteFormScreen = (
  _: Translator,
  row: Partial<SiteRow>,
  themes: FormOption[],
  frame: Frame,
  options: { errors?: string[]; locale?: string } = {},
): TemplateResult => {
  const existing = !!row.id
  return (
    <FormScreenFrame
      translator={_}
      title={existing ? String(row.title ?? row.name) : _('website_backend.sites.newTitle')}
      frame={frame}
      body={
        <Section
          eyebrow={_('website_backend.sites.eyebrow')}
          title={existing ? String(row.title ?? row.name) : _('website_backend.sites.newTitle')}
          description={_('website_backend.sites.formHint')}
          body={
            <Surface
              body={
                <RecordForm
                  action={
                    existing
                      ? `/admin/website/sites/${row.id}${options.locale ?? ''}`
                      : `/admin/website/sites/new${options.locale ?? ''}`
                  }
                  fields={[
                    { name: 'name', label: _('website_backend.field.name'), value: row.name, required: true },
                    {
                      name: 'title',
                      label: _('website_backend.field.siteTitle'),
                      value: row.title,
                      required: true,
                    },
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
                  ]}
                  submit={_('website_backend.action.save')}
                  submitVariant="primary"
                  errors={options.errors}
                  cancelHref={`/admin/website/sites${options.locale ?? ''}`}
                  cancelLabel={_('website_backend.action.cancel')}
                />
              }
            />
          }
        />
      }
    />
  )
}

export const contentScreen = (
  _: Translator,
  rows: EntryRow[],
  sites: FormOption[],
  siteId: string | null,
  frame: Frame,
  locale = '',
  kind: EntryKind = { basePath: '/admin/website/pages', titleKey: 'pages' },
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_(`website_backend.${kind.titleKey}.title`)}
    frame={frame}
    body={stack([
      <Surface
        padding="compact"
        body={
          <RecordForm
            action={`${kind.basePath}${locale}`}
            method="get"
            layout="inline"
            fields={[
              {
                name: 'site',
                label: _('website_backend.field.site'),
                type: 'select',
                value: siteId,
                options: sites,
              },
            ]}
            submit={_('website_backend.action.switchSite')}
            submitVariant="secondary"
          />
        }
      />,
      inline([
        linkButton({
          label: _(`website_backend.action.new${kind.titleKey === 'pages' ? 'Page' : 'Post'}`),
          href: `${kind.basePath}/new?site=${encodeURIComponent(siteId ?? '')}${locale ? `&${locale.slice(1)}` : ''}`,
          variant: 'primary',
        }),
        linkButton({
          label: _('website_backend.action.taxonomies'),
          href: `/admin/website/taxonomies?site=${encodeURIComponent(siteId ?? '')}${locale ? `&${locale.slice(1)}` : ''}`,
        }),
        linkButton({
          label: _('website_backend.action.preflight'),
          href: `/admin/website/preflight?site=${encodeURIComponent(siteId ?? '')}${locale ? `&${locale.slice(1)}` : ''}`,
        }),
      ]),
      !siteId
        ? emptyState(_('website_backend.content.noSite'), _('website_backend.content.noSiteHint'))
        : rows.length === 0
          ? emptyState(_('website_backend.content.empty'), _('website_backend.content.emptyHint'))
          : dataTable(_, {
              rows,
              id: (row) => row.id,
              rowHref: (row) => `${kind.basePath}/${row.id}${locale}`,
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
                {
                  key: 'status',
                  label: _('website_backend.field.status'),
                  kind: 'status',
                  cell: (row) => badge(_(`website_backend.state.${row.status}`), statusTone(row.status)),
                },
              ],
            }),
    ])}
  />
)

export const entryFormScreen = (
  _: Translator,
  detail: EntryDetail | null,
  siteId: string,
  kind: EntryKind,
  frame: Frame,
  options: { values?: Record<string, string>; errors?: string[]; locale?: string } = {},
): TemplateResult => {
  const entry = detail?.entry
  const revision = detail?.revision
  const values = options.values ?? {}
  const existing = !!entry
  const action = existing
    ? `${kind.basePath}/${entry.id}${options.locale ?? ''}`
    : `${kind.basePath}/new${options.locale ?? ''}`
  const layout =
    values.layout ??
    JSON.stringify(revision?.layout ?? [{ type: 'website.rich_text', settings: { body: '' } }], null, 2)
  const fields = values.fields ?? JSON.stringify(revision?.fields ?? {}, null, 2)
  return (
    <FormScreenFrame
      translator={_}
      title={existing ? String(entry.title) : _(`website_backend.${kind.titleKey}.newTitle`)}
      frame={frame}
      body={stack([
        ...(existing
          ? [
              inline([
                badge(_(`website_backend.state.${entry.status}`), statusTone(entry.status)),
                linkButton({
                  label: _('website_backend.action.revisions'),
                  href: `${kind.basePath}/${entry.id}/revisions${options.locale ?? ''}`,
                }),
                linkButton({
                  label: _('website_backend.action.preview'),
                  href: `${kind.basePath}/${entry.id}/preview${options.locale ?? ''}`,
                }),
              ]),
            ]
          : []),
        <Section
          eyebrow={_('website_backend.content.eyebrow')}
          title={existing ? String(entry.title) : _(`website_backend.${kind.titleKey}.newTitle`)}
          description={_(`website_backend.${kind.titleKey}.formHint`)}
          body={
            <Surface
              body={
                <RecordForm
                  action={action}
                  hidden={{
                    siteId,
                    ...(revision?.id ? { expectedRevisionId: revision.id } : {}),
                  }}
                  fields={[
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
                  ]}
                  submit={_('website_backend.action.saveDraft')}
                  submitVariant="primary"
                  errors={options.errors}
                  cancelHref={`${kind.basePath}?site=${encodeURIComponent(siteId)}${options.locale ? `&${options.locale.slice(1)}` : ''}`}
                  cancelLabel={_('website_backend.action.cancel')}
                />
              }
            />
          }
        />,
        ...(existing
          ? [
              <Section
                title={_('website_backend.publish.title')}
                description={_('website_backend.publish.hint')}
                body={
                  <Surface
                    body={
                      <RecordActions
                        action={`${kind.basePath}/${entry.id}/publish${options.locale ?? ''}`}
                        hidden={revision?.id ? { expectedRevisionId: revision.id } : undefined}
                        actions={[
                          {
                            value: 'publish',
                            label: _('website_backend.action.publish'),
                            variant: 'primary',
                          },
                        ]}
                      />
                    }
                  />
                }
              />,
            ]
          : []),
      ])}
    />
  )
}

export type RevisionRow = {
  id: string
  version: number
  kind: string
  authorId?: string | null
  createdAt: string
}

export type RevisionDiff = {
  fromVersion: number
  toVersion: number
  identified: boolean
  changes: Array<{
    id: string
    type: string
    change: string
    path: string
    from?: string | number
    fields?: string[]
  }>
}

/**
 * What a revision did, without restoring it to find out.
 *
 * The list was dates and authors: to see what a revision changed, someone had
 * to restore it and look. `diffRevisions` has been able to answer since it was
 * written and nothing asked it. It defaults to the newest two, because "what
 * changed?" is the question people arrive at this screen holding.
 */
const revisionCompare = (
  _: Translator,
  entry: EntryRow,
  rows: RevisionRow[],
  diff: RevisionDiff | null,
  basePath: string,
  locale: string,
): TemplateResult => {
  const options = rows.map((row) => ({
    value: row.id,
    label: `${_('website_backend.field.version')} ${row.version} · ${row.kind}`,
  }))
  return (
    <Section
      title={_('website_backend.revisions.compare')}
      description={_('website_backend.revisions.compareHint')}
      body={stack([
        <Surface
          padding="compact"
          body={
            <RecordForm
              action={`${basePath}/${entry.id}/revisions${locale}`}
              method="get"
              layout="inline"
              fields={[
                {
                  name: 'from',
                  label: _('website_backend.revisions.from'),
                  type: 'select',
                  options,
                  value: diff ? rows.find((row) => row.version === diff.fromVersion)?.id : undefined,
                },
                {
                  name: 'to',
                  label: _('website_backend.revisions.to'),
                  type: 'select',
                  options,
                  value: diff ? rows.find((row) => row.version === diff.toVersion)?.id : undefined,
                },
              ]}
              submit={_('website_backend.revisions.compare')}
              submitVariant="secondary"
            />
          }
        />,
        ...(diff && !diff.identified
          ? [
              <Notice
                tone="info"
                title={_('website_backend.revisions.unidentified')}
                message={_('website_backend.revisions.unidentifiedHint')}
              />,
            ]
          : []),
        ...(diff
          ? [
              diff.changes.length === 0
                ? emptyState(
                    _('website_backend.revisions.noChanges'),
                    _('website_backend.revisions.noChangesHint'),
                  )
                : dataTable(_, {
                    rows: diff.changes,
                    id: (row) => `${row.id}:${row.change}`,
                    columns: [
                      {
                        key: 'change',
                        label: _('website_backend.revisions.change'),
                        priority: 'primary',
                        cell: (row) => badge(row.change, row.change === 'removed' ? 'neutral' : 'info'),
                      },
                      {
                        key: 'section',
                        label: _('website_backend.revisions.section'),
                        cell: (row) => row.type,
                      },
                      {
                        key: 'where',
                        label: _('website_backend.revisions.where'),
                        cell: (row) =>
                          row.change === 'moved' && row.from !== undefined
                            ? `${row.from} → ${row.path}`
                            : row.path,
                      },
                      {
                        key: 'detail',
                        label: _('website_backend.revisions.detail'),
                        cell: (row) =>
                          row.fields?.length
                            ? row.fields.join(', ')
                            : row.change === 'retyped' && row.from !== undefined
                              ? String(row.from)
                              : '',
                      },
                    ],
                  }),
            ]
          : []),
      ])}
    />
  )
}

export const revisionsScreen = (
  _: Translator,
  entry: EntryRow,
  rows: RevisionRow[],
  frame: Frame,
  locale = '',
  basePath = '/admin/website/pages',
  diff: RevisionDiff | null = null,
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('website_backend.revisions.title')}
    frame={frame}
    body={stack([
      inline([
        linkButton({
          label: _('website_backend.action.backToEntry'),
          href: `${basePath}/${entry.id}${locale}`,
        }),
      ]),
      ...(rows.length > 1 ? [revisionCompare(_, entry, rows, diff, basePath, locale)] : []),
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
    ])}
  />
)

export const previewScreen = (
  _: Translator,
  entry: EntryRow,
  token: string,
  expiresAt: string,
  frame: Frame,
  basePath = '/admin/website/pages',
): TemplateResult => (
  <RecordScreen
    translator={_}
    title={_('website_backend.preview.title')}
    frame={frame}
    body={stack([
      <Notice tone="info" title={entry.title} message={_('website_backend.preview.hint')} />,
      <Surface
        body={
          <RecordForm
            action={basePath}
            method="get"
            fields={[
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
            ]}
            submit={_('website_backend.action.backToContent')}
            submitVariant="secondary"
          />
        }
      />,
    ])}
  />
)

const siteSwitcher = (
  _: Translator,
  action: string,
  sites: FormOption[],
  siteId: string | null,
  locale: string,
): TemplateResult => (
  <Surface
    padding="compact"
    body={
      <RecordForm
        action={`${action}${locale}`}
        method="get"
        layout="inline"
        fields={[
          {
            name: 'site',
            label: _('website_backend.field.site'),
            type: 'select',
            value: siteId,
            options: sites,
          },
        ]}
        submit={_('website_backend.action.switchSite')}
        submitVariant="secondary"
      />
    }
  />
)

export const taxonomyScreen = (
  _: Translator,
  rows: TaxonomyRow[],
  sites: FormOption[],
  siteId: string | null,
  frame: Frame,
  locale = '',
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('website_backend.taxonomies.title')}
    frame={frame}
    body={stack([
      siteSwitcher(_, '/admin/website/taxonomies', sites, siteId, locale),
      inline([
        linkButton({
          label: _('website_backend.action.newTerm'),
          href: `/admin/website/taxonomies/new?site=${encodeURIComponent(siteId ?? '')}${locale ? `&${locale.slice(1)}` : ''}`,
          variant: 'primary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('website_backend.taxonomies.empty'), _('website_backend.taxonomies.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            rowHref: (row) => `/admin/website/taxonomies/${row.id}${locale}`,
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
    ])}
  />
)

export const taxonomyFormScreen = (
  _: Translator,
  row: Partial<TaxonomyRow>,
  taxonomies: FormOption[],
  parents: FormOption[],
  frame: Frame,
  options: { errors?: string[]; locale?: string } = {},
): TemplateResult => {
  const existing = !!row.id
  return (
    <FormScreenFrame
      translator={_}
      title={existing ? String(row.name) : _('website_backend.taxonomies.newTitle')}
      frame={frame}
      body={stack([
        <Section
          title={existing ? String(row.name) : _('website_backend.taxonomies.newTitle')}
          description={_('website_backend.taxonomies.formHint')}
          body={
            <Surface
              body={
                <RecordForm
                  action={
                    existing
                      ? `/admin/website/taxonomies/${row.id}${options.locale ?? ''}`
                      : `/admin/website/taxonomies/new${options.locale ?? ''}`
                  }
                  hidden={{ siteId: String(row.siteId ?? '') }}
                  fields={[
                    { name: 'name', label: _('website_backend.field.name'), value: row.name, required: true },
                    { name: 'slug', label: _('website_backend.field.slug'), value: row.slug, required: true },
                    {
                      name: 'taxonomy',
                      label: _('website_backend.field.taxonomy'),
                      type: 'select',
                      value: row.taxonomy ?? taxonomies[0]?.value,
                      options: taxonomies,
                      required: true,
                      disabled: existing,
                    },
                    {
                      name: 'parentId',
                      label: _('website_backend.field.parent'),
                      type: 'select',
                      value: row.parentId ?? '',
                      options: [{ value: '', label: '—' }, ...parents],
                    },
                    {
                      name: 'description',
                      label: _('website_backend.field.description'),
                      type: 'textarea',
                      value: row.description,
                      span: 'full',
                    },
                  ]}
                  submit={_('website_backend.action.save')}
                  submitVariant="primary"
                  errors={options.errors}
                  cancelHref={`/admin/website/taxonomies?site=${encodeURIComponent(String(row.siteId ?? ''))}${options.locale ? `&${options.locale.slice(1)}` : ''}`}
                  cancelLabel={_('website_backend.action.cancel')}
                />
              }
            />
          }
        />,
        ...(existing
          ? [
              <Surface
                body={
                  <RecordActions
                    action={`/admin/website/taxonomies/${row.id}/delete${options.locale ?? ''}`}
                    actions={[
                      {
                        value: 'delete',
                        label: _('website_backend.action.deleteTerm'),
                        variant: 'destructive',
                      },
                    ]}
                  />
                }
              />,
            ]
          : []),
      ])}
    />
  )
}

export const mediaScreen = (
  _: Translator,
  rows: MediaRow[],
  sites: FormOption[],
  siteId: string | null,
  frame: Frame,
  locale = '',
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('website_backend.media.title')}
    frame={frame}
    body={stack([
      siteSwitcher(_, '/admin/website/media', sites, siteId, locale),
      inline([
        linkButton({
          label: _('website_backend.action.newMedia'),
          href: `/admin/website/media/new?site=${encodeURIComponent(siteId ?? '')}${locale ? `&${locale.slice(1)}` : ''}`,
          variant: 'primary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('website_backend.media.empty'), _('website_backend.media.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            rowHref: (row) => `/admin/website/media/${row.id}${locale}`,
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
    ])}
  />
)

export const mediaFormScreen = (
  _: Translator,
  row: Partial<MediaRow>,
  frame: Frame,
  options: { errors?: string[]; locale?: string } = {},
): TemplateResult => {
  const existing = !!row.id
  return (
    <FormScreenFrame
      translator={_}
      title={existing ? String(row.attachmentId) : _('website_backend.media.newTitle')}
      frame={frame}
      body={stack([
        <Section
          title={existing ? String(row.attachmentId) : _('website_backend.media.newTitle')}
          description={_('website_backend.media.formHint')}
          body={
            <Surface
              body={
                <RecordForm
                  action={
                    existing
                      ? `/admin/website/media/${row.id}${options.locale ?? ''}`
                      : `/admin/website/media/new${options.locale ?? ''}`
                  }
                  hidden={{ siteId: String(row.siteId ?? '') }}
                  fields={[
                    {
                      name: 'attachmentId',
                      label: _('website_backend.field.attachment'),
                      value: row.attachmentId,
                      required: true,
                      span: 'full',
                    },
                    { name: 'alt', label: _('website_backend.field.alt'), value: row.alt, span: 'full' },
                    {
                      name: 'caption',
                      label: _('website_backend.field.caption'),
                      type: 'textarea',
                      value: row.caption,
                      span: 'full',
                    },
                    {
                      name: 'width',
                      label: _('website_backend.field.width'),
                      type: 'number',
                      value: row.width,
                    },
                    {
                      name: 'height',
                      label: _('website_backend.field.height'),
                      type: 'number',
                      value: row.height,
                    },
                  ]}
                  submit={_('website_backend.action.save')}
                  submitVariant="primary"
                  errors={options.errors}
                  cancelHref={`/admin/website/media?site=${encodeURIComponent(String(row.siteId ?? ''))}${options.locale ? `&${options.locale.slice(1)}` : ''}`}
                  cancelLabel={_('website_backend.action.cancel')}
                />
              }
            />
          }
        />,
        ...(existing
          ? [
              <Surface
                body={
                  <RecordActions
                    action={`/admin/website/media/${row.id}/delete${options.locale ?? ''}`}
                    actions={[
                      {
                        value: 'delete',
                        label: _('website_backend.action.deleteMedia'),
                        variant: 'destructive',
                      },
                    ]}
                  />
                }
              />,
            ]
          : []),
      ])}
    />
  )
}

export type DanglingLink = { id: string; label: string; href: string }

export type PreflightResult = {
  ok: boolean
  checked: number
  capped?: boolean
  unrenderable: Array<{ entryId: string; path: string; errors: Array<{ message: string }> }>
}

/**
 * What would break if this site were published now.
 *
 * Not on the content list, which renders on every visit: the check reads a
 * revision per page, and a list that quietly costs a thousand reads is a list
 * nobody should have to think about. It is a button, and this is where it
 * lands.
 */
export const preflightScreen = (
  _: Translator,
  result: PreflightResult,
  siteId: string,
  frame: Frame,
  locale = '',
): TemplateResult => (
  <RecordScreen
    translator={_}
    title={_('website_backend.preflight.title')}
    frame={frame}
    body={stack([
      inline([
        linkButton({
          label: _('website_backend.action.backToContent'),
          href: `/admin/website/pages?site=${encodeURIComponent(siteId)}${locale ? `&${locale.slice(1)}` : ''}`,
        }),
      ]),
      ...(result.capped
        ? [
            <Notice
              tone="warning"
              title={_('website_backend.preflight.capped')}
              message={_('website_backend.preflight.cappedHint')}
            />,
          ]
        : []),
      <Notice
        tone={result.ok ? 'positive' : 'warning'}
        title={result.ok ? _('website_backend.preflight.clean') : _('website_backend.preflight.broken')}
        message={`${_('website_backend.preflight.checked')}: ${result.checked}`}
      />,
      ...(result.unrenderable.length
        ? [
            <Surface
              body={dataTable(_, {
                rows: result.unrenderable,
                id: (row) => row.entryId,
                columns: [
                  {
                    key: 'path',
                    label: _('website_backend.field.path'),
                    priority: 'primary',
                    cell: (row) => row.path,
                  },
                  {
                    key: 'why',
                    label: _('website_backend.preflight.why'),
                    cell: (row) => row.errors.map((error) => error.message).join(' · '),
                  },
                ],
              })}
            />,
          ]
        : []),
    ])}
  />
)

/**
 * Links that lead nowhere, said on the screen where they are edited.
 *
 * A menu item and the page it names are edited on different screens on
 * different days, so nobody was ever looking at both. The check has existed
 * since website_menu.preflightMenu; this is it, where the links are.
 */
const danglingNotice = (_: Translator, dangling: DanglingLink[]): TemplateResult[] =>
  dangling.length === 0
    ? []
    : [
        <Notice
          tone="warning"
          title={_('website_backend.menus.dangling')}
          message={`${_('website_backend.menus.danglingHint')} ${dangling
            .map((item) => `${item.label} (${item.href})`)
            .join(' · ')}`}
        />,
      ]

export const menusScreen = (
  _: Translator,
  rows: MenuRow[],
  sites: FormOption[],
  siteId: string | null,
  frame: Frame,
  locale = '',
  dangling: DanglingLink[] = [],
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('website_backend.menus.title')}
    frame={frame}
    body={stack([
      siteSwitcher(_, '/admin/website/menus', sites, siteId, locale),
      ...danglingNotice(_, dangling),
      inline([
        linkButton({
          label: _('website_backend.action.newMenuItem'),
          href: `/admin/website/menus/new?site=${encodeURIComponent(siteId ?? '')}${locale ? `&${locale.slice(1)}` : ''}`,
          variant: 'primary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('website_backend.menus.empty'), _('website_backend.menus.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            rowHref: (row) =>
              `/admin/website/menus/${row.id}?site=${encodeURIComponent(row.siteId)}${locale ? `&${locale.slice(1)}` : ''}`,
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
    ])}
  />
)

export const menuFormScreen = (
  _: Translator,
  row: Partial<MenuRow>,
  parents: FormOption[],
  frame: Frame,
  options: { errors?: string[]; locale?: string } = {},
): TemplateResult => {
  const existing = !!row.id
  return (
    <FormScreenFrame
      translator={_}
      title={existing ? String(row.label) : _('website_backend.menus.newTitle')}
      frame={frame}
      body={stack([
        <Section
          title={existing ? String(row.label) : _('website_backend.menus.newTitle')}
          description={_('website_backend.menus.formHint')}
          body={
            <Surface
              body={
                <RecordForm
                  action={
                    existing
                      ? `/admin/website/menus/${row.id}${options.locale ?? ''}`
                      : `/admin/website/menus/new${options.locale ?? ''}`
                  }
                  hidden={{ siteId: String(row.siteId ?? '') }}
                  fields={[
                    {
                      name: 'label',
                      label: _('website_backend.field.label'),
                      value: row.label,
                      required: true,
                    },
                    { name: 'href', label: _('website_backend.field.href'), value: row.href, required: true },
                    {
                      name: 'position',
                      label: _('website_backend.field.position'),
                      type: 'number',
                      value: row.position ?? 0,
                      required: true,
                    },
                    {
                      name: 'parentId',
                      label: _('website_backend.field.parent'),
                      type: 'select',
                      value: row.parentId ?? '',
                      options: [{ value: '', label: '—' }, ...parents],
                    },
                  ]}
                  submit={_('website_backend.action.save')}
                  submitVariant="primary"
                  errors={options.errors}
                  cancelHref={`/admin/website/menus?site=${encodeURIComponent(String(row.siteId ?? ''))}${options.locale ? `&${options.locale.slice(1)}` : ''}`}
                  cancelLabel={_('website_backend.action.cancel')}
                />
              }
            />
          }
        />,
        ...(existing
          ? [
              <Surface
                body={
                  <RecordActions
                    action={`/admin/website/menus/${row.id}/delete${options.locale ?? ''}`}
                    hidden={{ siteId: String(row.siteId ?? '') }}
                    actions={[
                      {
                        value: 'delete',
                        label: _('website_backend.action.deleteMenuItem'),
                        variant: 'destructive',
                      },
                    ]}
                  />
                }
              />,
            ]
          : []),
      ])}
    />
  )
}

/** What listForms returns, named so a route can hand it over without a cast. */
export type FormRow = {
  id: string
  name: string
  active: boolean
  schema?: unknown
  successMessage?: string
  notifyTo?: string | null
  consentText?: string | null
  summaryFields?: string[] | null
  retentionDays?: number | null
}

export const formsScreen = (
  _: Translator,
  rows: FormRow[],
  siteId: string | null,
  frame: Frame,
  locale = '',
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('website_backend.forms.title')}
    frame={frame}
    body={stack([
      inline([
        linkButton({
          label: _('website_backend.action.newForm'),
          href: `/admin/website/forms/new?site=${encodeURIComponent(siteId ?? '')}${locale ? `&${locale.slice(1)}` : ''}`,
          variant: 'primary',
        }),
      ]),
      rows.length === 0
        ? emptyState(_('website_backend.forms.empty'), _('website_backend.forms.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            // The row opens the form, the way a row opens the record on every
            // other list here. Submissions were the row's destination only
            // because there was nothing else to open.
            rowHref: (row) => `/admin/website/forms/${row.id}${locale}`,
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
              {
                key: 'retention',
                label: _('website_backend.field.retentionDays'),
                cell: (row) =>
                  row.retentionDays == null
                    ? badge(_('website_backend.state.kept'), 'neutral')
                    : String(row.retentionDays),
              },
              {
                key: 'submissions',
                label: _('website_backend.submissions.title'),
                cell: (row) =>
                  linkButton({
                    label: _('website_backend.action.open'),
                    href: `/admin/website/forms/${row.id}/submissions${locale}`,
                    size: 'compact',
                  }),
              },
            ],
          }),
    ])}
  />
)

/**
 * One editor, for a new form and an existing one.
 *
 * A form could be created and never edited: there was no route for it. So the
 * privacy notice could not be set at all, and the versioned-consent machinery
 * behind it was unreachable from the product. Retention has the same problem in
 * a sharper form - it is decided after a privacy review, which is never the
 * moment someone is typing a form's name.
 */
export const formEditorScreen = (
  _: Translator,
  siteId: string,
  frame: Frame,
  options: {
    id?: string | null
    values?: Record<string, string>
    errors?: string[]
    locale?: string
  } = {},
): TemplateResult => (
  <FormScreenFrame
    translator={_}
    title={_(options.id ? 'website_backend.forms.editTitle' : 'website_backend.forms.newTitle')}
    frame={frame}
    body={
      <Section
        title={_(options.id ? 'website_backend.forms.editTitle' : 'website_backend.forms.newTitle')}
        description={_('website_backend.forms.formHint')}
        body={
          <Surface
            body={
              <RecordForm
                action={
                  options.id
                    ? `/admin/website/forms/${encodeURIComponent(options.id)}${options.locale ?? ''}`
                    : `/admin/website/forms/new${options.locale ?? ''}`
                }
                hidden={{ siteId }}
                fields={[
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
                    name: 'consentText',
                    label: _('website_backend.field.consentText'),
                    type: 'textarea',
                    value: options.values?.consentText,
                    help: _('website_backend.help.consentText'),
                    span: 'full',
                  },
                  {
                    name: 'summaryFields',
                    label: _('website_backend.field.summaryFields'),
                    type: 'text',
                    value: options.values?.summaryFields,
                    help: _('website_backend.help.summaryFields'),
                  },
                  {
                    name: 'retentionDays',
                    label: _('website_backend.field.retentionDays'),
                    type: 'number',
                    value: options.values?.retentionDays,
                    help: _('website_backend.help.retentionDays'),
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
                ]}
                submit={_('website_backend.action.save')}
                submitVariant="primary"
                errors={options.errors}
                cancelHref={`/admin/website/forms?site=${encodeURIComponent(siteId)}${options.locale ? `&${options.locale.slice(1)}` : ''}`}
                cancelLabel={_('website_backend.action.cancel')}
              />
            }
          />
        }
      />
    }
  />
)

export type SubmissionRecord = {
  id: string
  formId: string
  payload: Record<string, unknown>
  schemaVersion?: number | null
  consent: boolean
  consentText?: string | null
  status: string
  source?: string | null
  createdAt: string
  purgedAt?: string | null
  holdReason?: string | null
}

export type SubmissionAuditRow = {
  id: string
  action: string
  actorKey: string
  submissionId?: string | null
  fields?: string[] | null
  rowCount?: number | null
  reason?: string | null
  occurredAt: string
}

/**
 * One submission, opened on purpose.
 *
 * The queue deliberately carries no answers, so this is the only screen where
 * anyone reads what a visitor wrote - and the only place the audit trail
 * records a person rather than a call that never happened. The trail is shown
 * on the same page as the answers: a record of who looked is worth more when
 * the person looking can see it too.
 */
export const submissionRecordScreen = (
  _: Translator,
  record: SubmissionRecord,
  audit: SubmissionAuditRow[],
  frame: Frame,
  locale = '',
): TemplateResult => {
  const answers = Object.entries(record.payload ?? {}).map(([field, value]) => ({
    id: field,
    field,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }))
  return (
    <RecordScreen
      translator={_}
      title={_('website_backend.submission.title')}
      frame={frame}
      body={stack([
        ...(record.purgedAt
          ? [
              <Notice
                tone="info"
                title={_('website_backend.state.purged')}
                message={_('website_backend.submission.purgedHint')}
              />,
            ]
          : []),
        ...(record.holdReason
          ? [<Notice tone="warning" title={_('website_backend.field.hold')} message={record.holdReason} />]
          : []),
        <Section
          title={_('website_backend.submission.answers')}
          body={
            <Surface
              body={
                answers.length === 0
                  ? emptyState(
                      _('website_backend.submission.noAnswers'),
                      _('website_backend.submission.noAnswersHint'),
                    )
                  : dataTable(_, {
                      rows: answers,
                      id: (row) => row.id,
                      columns: [
                        {
                          key: 'field',
                          label: _('website_backend.field.name'),
                          priority: 'primary',
                          cell: (row) => row.field,
                        },
                        {
                          key: 'value',
                          label: _('website_backend.submission.answer'),
                          cell: (row) => row.value,
                        },
                      ],
                    })
              }
            />
          }
        />,
        <Section
          title={_('website_backend.field.consent')}
          // The notice is stored verbatim on the submission, because a Form is
          // one mutable row and the version alone cannot recover the text.
          description={_('website_backend.submission.consentHint')}
          body={
            <Surface
              body={stack([
                badge(
                  record.consent ? _('website_backend.state.yes') : _('website_backend.state.no'),
                  record.consent ? 'positive' : 'neutral',
                ),
                ...(record.consentText ? [code(record.consentText)] : []),
              ])}
            />
          }
        />,
        <Section
          title={_('website_backend.field.hold')}
          description={_('website_backend.submission.holdHint')}
          body={
            <Surface
              body={
                <RecordForm
                  action={`/admin/website/forms/${record.formId}/submissions/${record.id}${locale}`}
                  fields={[
                    {
                      name: 'holdReason',
                      label: _('website_backend.submission.holdReason'),
                      value: record.holdReason ?? '',
                      help: _('website_backend.submission.holdReasonHint'),
                      span: 'full',
                    },
                  ]}
                  submit={_('website_backend.action.save')}
                  submitVariant="secondary"
                />
              }
            />
          }
        />,
        <Section
          title={_('website_backend.submission.audit')}
          description={_('website_backend.submission.auditHint')}
          body={
            <Surface
              body={
                audit.length === 0
                  ? emptyState(
                      _('website_backend.submission.noAudit'),
                      _('website_backend.submission.noAuditHint'),
                    )
                  : dataTable(_, {
                      rows: audit,
                      id: (row) => row.id,
                      columns: [
                        {
                          key: 'occurredAt',
                          label: _('website_backend.field.createdAt'),
                          kind: 'date',
                          priority: 'primary',
                          cell: (row) => row.occurredAt,
                        },
                        {
                          key: 'action',
                          label: _('website_backend.submission.action'),
                          cell: (row) => badge(row.action, 'info'),
                        },
                        {
                          key: 'actorKey',
                          label: _('website_backend.submission.actor'),
                          cell: (row) => row.actorKey,
                        },
                        {
                          key: 'reason',
                          label: _('website_backend.submission.reason'),
                          cell: (row) => row.reason ?? '',
                        },
                      ],
                    })
              }
            />
          }
        />,
      ])}
    />
  )
}

export type SubmissionRow = {
  id: string
  formId: string
  summary: Record<string, unknown>
  consent: boolean
  status: string
  createdAt: string
  held?: boolean
  holdReason?: string | null
  purgedAt?: string | null
}

/**
 * The queue, showing what the queue is allowed to show.
 *
 * This column used to print the whole payload. It cannot any more, and should
 * not have: working a contact form meant reading everyone's phone number
 * whether or not that was the job. What it shows now is whichever answers the
 * form itself declares safe to preview - nothing, unless someone chose
 * otherwise - and it says which of the two empty cases it is looking at, so a
 * blank column reads as a decision rather than as a broken screen.
 */
export const submissionsScreen = (_: Translator, rows: SubmissionRow[], frame: Frame): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('website_backend.submissions.title')}
    frame={frame}
    body={
      rows.length === 0
        ? emptyState(_('website_backend.submissions.empty'), _('website_backend.submissions.emptyHint'))
        : dataTable(_, {
            rows,
            id: (row) => row.id,
            rowHref: (row) => `/admin/website/forms/${row.formId}/submissions/${row.id}`,
            columns: [
              {
                key: 'created',
                label: _('website_backend.field.createdAt'),
                kind: 'date',
                priority: 'primary',
                cell: (row) => row.createdAt,
              },
              {
                key: 'summary',
                label: _('website_backend.field.summary'),
                cell: (row) =>
                  row.purgedAt
                    ? badge(_('website_backend.state.purged'), 'neutral')
                    : Object.keys(row.summary ?? {}).length
                      ? code(JSON.stringify(row.summary))
                      : badge(_('website_backend.state.noPreview'), 'neutral'),
              },
              {
                key: 'hold',
                label: _('website_backend.field.hold'),
                cell: (row) =>
                  row.held
                    ? badge(row.holdReason ?? _('website_backend.state.yes'), 'warning')
                    : badge(_('website_backend.state.no'), 'neutral'),
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
          })
    }
  />
)
