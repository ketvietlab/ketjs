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

export const revisionsScreen = (
  _: Translator,
  entry: EntryRow,
  rows: Array<{ id: string; version: number; kind: string; authorId?: string | null; createdAt: string }>,
  frame: Frame,
  locale = '',
  basePath = '/admin/website/pages',
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

export const menusScreen = (
  _: Translator,
  rows: MenuRow[],
  sites: FormOption[],
  siteId: string | null,
  frame: Frame,
  locale = '',
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('website_backend.menus.title')}
    frame={frame}
    body={stack([
      siteSwitcher(_, '/admin/website/menus', sites, siteId, locale),
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

export const formsScreen = (
  _: Translator,
  rows: Array<{ id: string; name: string; active: boolean }>,
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
            rowHref: (row) => `/admin/website/forms/${row.id}/submissions${locale}`,
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
    ])}
  />
)

export const formCreateScreen = (
  _: Translator,
  siteId: string,
  frame: Frame,
  options: { values?: Record<string, string>; errors?: string[]; locale?: string } = {},
): TemplateResult => (
  <FormScreenFrame
    translator={_}
    title={_('website_backend.forms.newTitle')}
    frame={frame}
    body={
      <Section
        title={_('website_backend.forms.newTitle')}
        description={_('website_backend.forms.formHint')}
        body={
          <Surface
            body={
              <RecordForm
                action={`/admin/website/forms/new${options.locale ?? ''}`}
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

export const submissionsScreen = (
  _: Translator,
  rows: Array<{ id: string; payload: unknown; consent: boolean; status: string; createdAt: string }>,
  frame: Frame,
): TemplateResult => (
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
          })
    }
  />
)
