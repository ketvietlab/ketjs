import { themeCards } from './theme-cards.tsx'
import { createMenuEditor } from './menu-editor.tsx'
import { formEditorView } from './form-editor-view.tsx'
import { ArchiveActions } from '../archive-actions.tsx'
import { menuItems, formFields, newMenuItem, newFormField } from '../content-schema.ts'
import {
  DataTable,
  FilterBar,
  SearchBar,
  ListPage,
  RecordPage,
  Surface,
  Stack,
  Grid,
  Field,
  TextField,
  TextArea,
  Select,
  LinkButton,
  Notice,
  Tree,
  ReorderList,
  Status,
} from '@ketvietlab/design-system'
import type { TreeNode } from '@ketvietlab/design-system'
import type { JSXChild } from '@ketvietlab/ketjs-view/jsx-runtime'
import { CommandButton, fragments, icon } from '../ui.tsx'
import { resourceSchemas, resourceValue } from '../resources.ts'
import type { ResourceRecord } from '../resources.ts'
import { entryStatus, newId } from './format.ts'
import type { FormField, MenuItem, Screen, StudioContext } from '../types.ts'

/** The SEO list's audit: which published pages miss what, and whether search has caught up. */
type SeoAudit = {
  publicationId?: string | null
  indexState: string
  rows: { id: string; title: string; missing: string[]; indexLag: boolean }[]
}
/** `website_studio.listResources` for one kind. */
type ResourceList = { rows: ResourceRecord[]; creatable?: boolean; audit?: SeoAudit | null }
type RowValues = Partial<MenuItem> & Partial<FormField>

export function createResourceScreens(ctx: StudioContext) {
  const screens: Record<string, Screen> = {}
  for (const [kind, schema] of Object.entries(resourceSchemas)) {
    if (['taxonomy', 'taxonomy-sets'].includes(kind)) continue
    const title = () => ctx.tr(`website.route.${kind}`)
    const editKey = `${kind}-edit`
    screens[kind] = {
      readKey: (route) => [route.query.q, route.query.set],
      read: (route, signal) =>
        ctx.call<ResourceList>(
          'website_studio.listResources',
          { siteId: ctx.site().id, kind, search: route.query.q ?? '', set: route.query.set },
          { signal },
        ),
      view: (data, route) => {
        const records = (
          <DataTable
            columns={[
              ...schema.fields
                .filter((field) =>
                  [
                    'title',
                    ...(kind === 'sites'
                      ? ['companyId', 'host', 'state', 'defaultLocale']
                      : schema.fields
                          .filter((f) => f.name !== 'title')
                          .slice(0, 2)
                          .map((f) => f.name)),
                  ].includes(field.name),
                )
                .map((field) => ({
                  key: field.name,
                  label: ctx.tr(
                    field.name === 'fields' || field.name === 'links'
                      ? 'website.resource.itemCount'
                      : field.label,
                  ),
                  priority: field.name === 'title' ? ('primary' as const) : ('secondary' as const),
                  cell: (row: ResourceRecord): JSXChild =>
                    ['schema', 'items'].includes(field.name)
                      ? (field.name === 'items' ? menuItems(row.items) : formFields(row.schema)).length
                      : field.kind.startsWith('select:')
                        ? row[field.name] == null
                          ? '—'
                          : ctx.tr(`website.option.${row[field.name]}`)
                        : (resourceValue(row[field.name]) ?? '—'),
                })),
              ...(kind === 'taxonomy-sets'
                ? ['termCount']
                : ['menus', 'themes', 'seo'].includes(kind)
                  ? ['state']
                  : []
              ).map((key) => ({
                key,
                label: ctx.tr(`website.resource.meta.${key}`),
                cell: (r: ResourceRecord): JSXChild =>
                  key === 'scan' ? (
                    ctx.tr(`website.option.${r[key]}`)
                  ) : key === 'state' ? (
                    <Status {...entryStatus(ctx.tr, String(r[key]))} />
                  ) : (
                    (resourceValue(r[key]) ?? '—')
                  ),
                kind: key === 'state' ? ('status' as const) : undefined,
              })),
            ]}
            rows={data.rows}
            id={(row) => row.id}
            rowHref={(row) =>
              kind === 'sites'
                ? ctx.href('overview', {}, { site: row.id })
                : ctx.href(editKey, { id: row.id })
            }
            emptyTitle={ctx.tr(route.query.q ? 'website.resource.noMatch' : 'website.resource.empty')}
            emptyMessage={
              route.query.q
                ? ctx.tr('website.resource.noMatchHelp')
                : data.creatable !== false && ctx.can(schema.capability)
                  ? ctx.tr('website.resource.emptyHelp')
                  : ctx.tr('website.resource.emptyReader')
            }
          />
        )
        return (
          <ListPage
            variant="operational"
            title={title()}
            // A host with a fixed set of records (one native menu per site) says so instead of failing on save.
            headerActions={
              data.creatable === false || !ctx.can(schema.capability) ? null : (
                <LinkButton
                  label={ctx.tr(kind === 'sites' ? 'website.site.create' : `website.resource.${kind}.create`)}
                  href={ctx.href(editKey, { id: 'new' }, { set: route.query.set })}
                  variant="primary"
                  leading={icon('plus')}
                />
              )
            }
            controls={
              <FilterBar
                label={title()}
                filters={[
                  <SearchBar
                    id={`search-${kind}`}
                    action={ctx.href(kind)}
                    label={ctx.tr('website.resource.search')}
                    value={route.query.q ?? ''}
                    placeholder={ctx.tr('website.resource.searchPlaceholder')}
                    submitLabel={ctx.tr('website.search.submit')}
                  />,
                ]}
              />
            }
            footer={ctx.tr('website.list.results', { count: data.rows.length })}
            body={
              kind === 'themes' ? (
                themeCards(ctx, data.rows)
              ) : kind === 'taxonomy' && data.rows.length ? (
                <Tree
                  label={title()}
                  nodes={(() => {
                    const nodes = (parent = ''): TreeNode[] =>
                      data.rows
                        .filter(
                          (r) =>
                            (r.parent ?? '') === parent ||
                            (parent === '' && r.parent && !data.rows.some((p) => p.id === r.parent)),
                        )
                        .map((r) => ({
                          id: r.id,
                          label: `${r.title} · ${r.usage?.length ?? 0}`,
                          href: ctx.href(editKey, { id: r.id }),
                          expanded: true,
                          children: nodes(r.id),
                        }))
                    return nodes()
                  })()}
                />
              ) : (
                <Stack
                  items={[
                    data.audit ? (
                      <Surface
                        title={ctx.tr('website.seo.audit')}
                        body={
                          <>
                            <p>
                              {data.audit.publicationId
                                ? `${ctx.tr('website.seo.sitemap')}: ${data.audit.publicationId} · `
                                : null}
                              {ctx.tr(`website.search.index.${data.audit.indexState}`)}
                            </p>
                            <DataTable
                              rows={data.audit.rows}
                              id={(r) => r.id}
                              emptyTitle={ctx.tr('website.seo.auditEmpty')}
                              emptyMessage={ctx.tr('website.seo.auditEmptyHelp')}
                              rowHref={(r) => ctx.href('builder', { id: r.id }, { panel: 'page-settings' })}
                              columns={[
                                {
                                  key: 'title',
                                  label: ctx.tr('website.entry.title'),
                                  cell: (r) => r.title,
                                },
                                {
                                  key: 'missing',
                                  label: ctx.tr('website.seo.missing'),
                                  cell: (r) =>
                                    r.missing.map((k) => ctx.tr(`website.resource.seo.${k}`)).join(' · ') ||
                                    '—',
                                },
                                {
                                  key: 'indexLag',
                                  label: ctx.tr('website.seo.indexLag'),
                                  cell: (r) =>
                                    ctx.tr(r.indexLag ? 'website.seo.pending' : 'website.seo.current'),
                                },
                              ]}
                            />
                          </>
                        }
                      />
                    ) : null,
                    data.audit ? (
                      // Saved overrides sit in their own region beside the audit, not floating under it.
                      <Surface title={ctx.tr('website.seo.records')} body={records} />
                    ) : (
                      records
                    ),
                  ]}
                />
              )
            }
          />
        )
      },
    } satisfies Screen<ResourceList>
    let current: ResourceRecord | null = null
    let pendingId: string | null = null
    let pendingDraft: { id: string; values: Record<string, unknown> } | null = null
    const structuredField = kind === 'menus' ? 'items' : kind === 'form-editor' ? 'schema' : null
    const isMenu = kind === 'menus'
    const readValues = (form: FormData) => {
      const values: Record<string, unknown> = Object.fromEntries(
        schema.fields
          // No destination control means the host offers none: keep what is saved rather than clear it.
          .filter(
            (field) =>
              field.name !== structuredField && (field.kind !== 'destination' || form.has(field.name)),
          )
          .map((field) => [field.name, String(form.get(field.name) ?? '').trim()]),
      )
      if (structuredField) {
        const count = Number(form.get('__rows') ?? 0)
        const rows = Array.from({ length: count }, (_, index) => {
          const get = (name: string) => String(form.get(`row-${index}-${name}`) ?? '').trim()
          const id = get('id')
          return isMenu
            ? ({
                id,
                label: get('label'),
                href: get('target'),
                parentId: get('parent') || null,
                position: index,
              } satisfies MenuItem)
            : ({
                id,
                name: get('key'),
                label: get('label'),
                type: get('type'),
                required: get('requirement') === 'required',
                maxLength: Number(get('maxLength')),
                classification: get('classification'),
              } satisfies FormField)
        })
        const order: string[] = form.get('__order')
          ? JSON.parse(String(form.get('__order')))
          : rows.map((row) => row.id)
        const byId = new Map<string, MenuItem | FormField>(rows.map((row) => [row.id, row]))
        const ordered = order.map((id, position) => {
          const row = byId.get(id) ?? (isMenu ? newMenuItem(id) : newFormField(id))
          if (!isMenu) return row
          const { parentId } = row as MenuItem
          return {
            ...row,
            position,
            parentId: parentId !== null && order.includes(parentId) ? parentId : null,
          }
        })
        values[structuredField] = isMenu ? ordered : { fields: ordered }
      }
      return values
    }
    const rowsEditor = (data: ResourceRecord) => {
      const rows: (MenuItem | FormField)[] = isMenu ? menuItems(data.items) : formFields(data.schema)
      const names = isMenu
        ? ['label', 'target', 'parent']
        : ['key', 'label', 'type', 'requirement', 'maxLength', 'classification']
      const disabled = !ctx.can(schema.capability)
      const fieldControl = (item: MenuItem | FormField, index: number, name: string) => {
        const row: RowValues = item
        const props = {
          id: `row-${index}-${name}`,
          name: `row-${index}-${name}`,
          disabled,
          label: ctx.tr(`website.resource.row.${name}`),
          value:
            (
              {
                key: row.name,
                target: row.href,
                parent: row.parentId ?? '',
                requirement: row.required ? 'required' : 'optional',
              } as Record<string, string | undefined>
            )[name] ??
            resourceValue((row as Record<string, unknown>)[name]) ??
            '',
        }
        if (name === 'parent')
          return (
            <Select
              {...props}
              label={ctx.tr('website.resource.menuParent')}
              options={[
                { value: '', label: ctx.tr('website.resource.noMenuParent') },
                // Only menu links nest, and every menu link has an id.
                ...(rows as MenuItem[])
                  .filter((r) => r.id !== row.id)
                  .map((r) => ({ value: r.id, label: r.label || ctx.tr('website.resource.untitledRow') })),
              ]}
            />
          )
        const options = (
          {
            classification: ['public', 'personal', 'sensitive'],
            requirement: ['required', 'optional'],
            type: ['text', 'email', 'tel', 'number', 'textarea', 'checkbox'],
          } as Record<string, string[]>
        )[name]
        if (options) {
          const prefix = (
            {
              classification: 'website.formClass.',
              requirement: 'website.resource.',
              type: 'website.fieldType.',
            } as Record<string, string>
          )[name]
          return (
            <Select
              {...props}
              label={ctx.tr(
                (
                  {
                    classification: 'website.resource.row.classification',
                    requirement: 'website.resource.requirement',
                    type: 'website.resource.fieldType',
                  } as Record<string, string>
                )[name],
              )}
              options={options.map((value) => ({ value, label: ctx.tr(prefix + value) }))}
            />
          )
        }
        return name === 'maxLength' ? <Field {...props} type="number" /> : <TextField {...props} />
      }
      const list = (
        <ReorderList
          id={`resource-rows-${kind}`}
          name="__order"
          label={ctx.tr('website.resource.rows')}
          disabled={disabled}
          labels={{
            add: ctx.tr('website.resource.addRow'),
            remove: ctx.tr('website.resource.removeRow'),
            up: ctx.tr('website.resource.upRow'),
            down: ctx.tr('website.resource.downRow'),
            drag: ctx.tr('website.resource.dragRow'),
            empty: ctx.tr('website.resource.emptyRows'),
          }}
          items={rows.map((row, index) => ({
            id: row.id!,
            content: (
              <>
                <input type="hidden" name={`row-${index}-id`} value={row.id} />
                {isMenu ? (
                  <Grid columns={2} items={names.map((name) => fieldControl(row, index, name))} />
                ) : (
                  <div class="website-form-config">
                    {fragments(
                      ['label', 'type', 'requirement'].map((name) => (
                        <div class="website-form-field">{fieldControl(row, index, name)}</div>
                      )),
                    )}
                    <input
                      type="hidden"
                      name={`row-${index}-key`}
                      value={(row as FormField).name || newFormField(row.id!).name}
                    />
                    <input
                      type="hidden"
                      name={`row-${index}-maxLength`}
                      value={(row as FormField).maxLength}
                    />
                    <input
                      type="hidden"
                      name={`row-${index}-classification`}
                      value={(row as FormField).classification}
                    />
                  </div>
                )}
              </>
            ),
          }))}
        />
      )
      // ReorderList has no icon slot yet; reuse the exact canonical glyph used by the builder.
      const grip = `url("data:image/svg+xml,${encodeURIComponent(icon('grip-vertical').html)}")`
      return (
        <>
          <input type="hidden" name="__rows" value={rows.length} />
          {isMenu ? (
            list
          ) : (
            <div class="website-form-reorder" style={`--website-reorder-grip: ${grip}`}>
              {list}
            </div>
          )}
        </>
      )
    }
    screens[editKey] = {
      readKey: (route) => route.params.id,
      read: async (route, signal) => {
        if (route.params.id === 'new' || kind === 'sites') {
          pendingId ??= newId(kind)
          current = {
            id: pendingId,
            revisionId: null,
            ...(kind === 'taxonomy' ? { taxonomyId: route.query.set ?? '' } : {}),
          }
        } else
          current = await ctx.call<ResourceRecord>(
            'website_studio.getResource',
            { siteId: ctx.site().id, kind, id: route.params.id },
            { signal },
          )
        if (kind === 'taxonomy') {
          const record = current
          const choices = await ctx.call<{
            rows: { id: string; title: string; taxonomyType: string; taxonomyId?: string }[]
          }>('website_studio.listResources', { siteId: ctx.site().id, kind }, { signal })
          record.sets = (
            await ctx.call<{ rows: { id: string; title: string }[] }>(
              'website_studio.listResources',
              { siteId: ctx.site().id, kind: 'taxonomy-sets' },
              { signal },
            )
          ).rows
          if (!record.taxonomyId) record.taxonomyId = record.sets[0]?.id ?? ''
          record.parents = choices.rows.filter(
            (r) => r.id !== record.id && r.taxonomyType === 'category' && r.taxonomyId === record.taxonomyId,
          )
        }
        return pendingDraft?.id === current.id ? { ...current, ...pendingDraft.values } : current
      },
      view: (data) =>
        kind === 'form-editor' ? (
          formEditorView(ctx, data, schema, rowsEditor(data), async (form) => {
            pendingDraft = { id: current!.id, values: readValues(form) }
            await ctx.refresh()
          })
        ) : (
          <RecordPage
            width="wide"
            title={data.title ?? title()}
            actions={
              <>
                <LinkButton
                  label={ctx.tr('website.resource.back')}
                  href={ctx.href(kind === 'form-editor' ? 'forms' : kind)}
                />
                {kind === 'themes' && data.affected?.[0]?.id ? (
                  <LinkButton
                    label={ctx.tr('website.builder.preview')}
                    href={ctx.href('builder', { id: data.affected[0].id }, { panel: 'styles' })}
                  />
                ) : null}
                <CommandButton
                  label={ctx.tr(
                    kind === 'form-editor' && data.revisionId
                      ? 'website.formJourney.newVersion'
                      : 'website.action.save',
                  )}
                  command={`resource.${kind}.save`}
                  type="submit"
                  form={`resource-${kind}`}
                  variant="primary"
                  disabled={ctx.busy() || !ctx.can(schema.capability)}
                />
                {data.revisionId && !['sites', 'domains', 'seo'].includes(kind)
                  ? ArchiveActions(ctx, {
                      id: `resource-${kind}-archive`,
                      title: data.title ?? title(),
                      command: `resource.${kind}.archive`,
                      disabled: ctx.busy() || !ctx.can(schema.capability),
                      usage: data.usage,
                      extraItems: [],
                    })
                  : null}
              </>
            }
            body={
              <Surface
                title={ctx.tr('website.resource.details')}
                body={
                  <Stack
                    items={[
                      data.kind === 'themes' ? (
                        <Notice
                          title={`${ctx.tr('website.resource.version')} ${data.version ?? ''}`}
                          message={ctx.tr('website.resource.themeCompatibility', {
                            count: data.compatibility?.length ?? 0,
                          })}
                          tone="info"
                        />
                      ) : null,
                      data.kind === 'menus' ? (
                        <Stack
                          items={(data.warnings ?? []).map((w) => (
                            <Notice
                              title={w.target}
                              message={ctx.tr(`website.menu.warning.${w.state}`)}
                              tone="warning"
                            />
                          ))}
                        />
                      ) : null,
                      kind === 'taxonomy-sets' && data.revisionId ? (
                        <LinkButton
                          label={ctx.tr('website.resource.taxonomySet.terms')}
                          href={ctx.href('taxonomy', {}, { set: data.id })}
                        />
                      ) : null,
                      kind === 'domains' ? (
                        <Notice title={title()} message={ctx.tr('website.resource.domainHelp')} tone="info" />
                      ) : null,
                      <form data-reorder={`resource.${kind}.reorder`} id={`resource-${kind}`} novalidate>
                        <Stack
                          items={[
                            <Grid
                              columns={2}
                              items={schema.fields
                                .filter((field) => field.name !== structuredField)
                                .map((field) => {
                                  const props = {
                                    id: `${kind}-${field.name}`,
                                    name: field.name,
                                    label: ctx.tr(field.label),
                                    value: resourceValue(data[field.name]) ?? field.defaultValue ?? '',
                                    required: field.required,
                                    disabled: !ctx.can(schema.capability),
                                  }
                                  if (kind === 'sites' && field.name === 'companyId')
                                    return (
                                      <Select
                                        {...props}
                                        value={data.companyId ?? ctx.boot().companies?.[0]?.id}
                                        options={(ctx.boot().companies ?? []).map((r) => ({
                                          value: r.id,
                                          label: r.name,
                                        }))}
                                      />
                                    )
                                  if (kind === 'taxonomy' && field.name === 'taxonomyId')
                                    return (
                                      <Select
                                        {...props}
                                        options={(data.sets ?? []).map((r) => ({
                                          value: r.id,
                                          label: r.title,
                                        }))}
                                      />
                                    )
                                  if (kind === 'taxonomy' && field.name === 'parent')
                                    return (
                                      <Select
                                        {...props}
                                        options={[
                                          { value: '', label: ctx.tr('website.resource.noParent') },
                                          ...(data.parents ?? []).map((r) => ({
                                            value: r.id,
                                            label: r.title,
                                          })),
                                        ]}
                                      />
                                    )
                                  if (field.kind.startsWith('select:')) {
                                    const values = field.kind.slice(7).split(',')
                                    return (
                                      <Select
                                        {...props}
                                        value={
                                          resourceValue(data[field.name]) ?? field.defaultValue ?? values[0]
                                        }
                                        options={values.map((value) => ({
                                          value,
                                          label: ctx.tr(`website.option.${value}`),
                                        }))}
                                      />
                                    )
                                  }
                                  const Input = field.kind === 'area' ? TextArea : TextField
                                  return (
                                    <Input {...props} span={field.kind === 'area' ? 'full' : undefined} />
                                  )
                                })}
                            />,
                            structuredField ? rowsEditor(data) : null,
                          ]}
                        />
                      </form>,
                    ]}
                  />
                }
              />
            }
          />
        ),
      commands: {
        [`resource.${kind}.archive`]: async (_args, form) => {
          await ctx.call('website_studio.archiveResource', {
            siteId: ctx.site().id,
            kind,
            id: current!.id,
            expectedRevisionId: current!.revisionId,
            confirmed: form!.has('confirmed'),
          })
          pendingDraft = null
          await ctx.navigate(kind === 'form-editor' ? 'forms' : kind)
        },
        [`resource.${kind}.reorder`]: async (_args, form) => {
          pendingDraft = { id: current!.id, values: readValues(form!) }
          await ctx.refresh()
        },
        [`resource.${kind}.save`]: async (_args, form) => {
          const values = readValues(form!)
          const record = current!
          if (schema.fields.some((field) => field.required && !values[field.name]))
            throw Object.assign(new Error(ctx.tr('website.resource.validation')), { code: 'validation' })
          await ctx.call(
            'website_studio.saveResource',
            { siteId: ctx.site().id, kind, id: record.id, expectedRevisionId: record.revisionId, values },
            record.revisionId ? {} : { key: record.id },
          )
          pendingId = null
          pendingDraft = null
          if (kind === 'sites') await ctx.reload()
          ctx.notify(ctx.tr('website.resource.saved'))
          await ctx.navigate(kind === 'form-editor' ? 'forms' : kind)
        },
      },
    } satisfies Screen<ResourceRecord>
  }
  screens['menus-edit'] = createMenuEditor(ctx)
  return screens
}
