import { themeCards } from './theme-cards.mjs'
import { createMenuEditor } from './menu-editor.mjs'
import { formEditorView } from './form-editor-view.mjs'
import { ArchiveActions } from '../archive-actions.mjs'
import { menuItems, formFields, newMenuItem, newFormField } from '../content-schema.mjs'
// Shared resource composition: each schema owns business fields, DS owns layout and controls.
import { html } from '@ketvietlab/ketjs-view'
import {
  DataTable,
  FilterBar,
  SearchBar,
  ListPage,
  RecordPage,
  Surface,
  Stack,
  Grid,
  TextField,
  TextArea,
  Select,
  LinkButton,
  Notice,
  Tree,
  ReorderList,
} from '@ketvietlab/design-system'
import { h, CommandButton, fragments, icon } from '../ui.mjs'
import { resourceSchemas } from '../resources.mjs'
import { newId } from './format.mjs'

export function createResourceScreens(ctx) {
  const screens = {}
  for (const [kind, schema] of Object.entries(resourceSchemas)) {
    if (['taxonomy', 'taxonomy-sets'].includes(kind)) continue
    const title = () => ctx.tr(`website.route.${kind}`)
    const editKey = `${kind}-edit`
    screens[kind] = {
      readKey: (route) => [route.query.q, route.query.set],
      read: (route, signal) =>
        ctx.call(
          'website_studio.listResources',
          { siteId: ctx.site().id, kind, search: route.query.q ?? '', set: route.query.set },
          { signal },
        ),
      view: (data, route) =>
        h(ListPage, {
          variant: 'operational',
          title: title(),
          // A host with a fixed set of records (one native menu per site) says so instead of failing on save.
          headerActions:
            data.creatable === false
              ? null
              : h(LinkButton, {
                  label: ctx.tr(kind === 'sites' ? 'website.site.create' : 'website.resource.create'),
                  href: ctx.href(editKey, { id: 'new' }, { set: route.query.set }),
                  variant: 'primary',
                }),
          controls: h(FilterBar, {
            label: title(),
            filters: [
              h(SearchBar, {
                id: `search-${kind}`,
                action: ctx.href(kind),
                label: ctx.tr('website.resource.search'),
                value: route.query.q ?? '',
                submitLabel: ctx.tr('website.search.submit'),
              }),
            ],
          }),
          footer: ctx.tr('website.list.results', { count: data.rows.length }),
          body:
            kind === 'themes'
              ? themeCards(ctx, data.rows)
              : kind === 'taxonomy' && data.rows.length
                ? h(Tree, {
                    label: title(),
                    nodes: (() => {
                      const nodes = (parent = '') =>
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
                    })(),
                  })
                : h(Stack, {
                    items: [
                      data.audit
                        ? h(Surface, {
                            title: ctx.tr('website.seo.audit'),
                            body: html`<p>${ctx.tr('website.seo.sitemap')}: ${data.audit.publicationId ?? '—'} · ${ctx.tr(`website.search.index.${data.audit.indexState}`)}</p>${h(
                              DataTable,
                              {
                                rows: data.audit.rows,
                                id: (r) => r.id,
                                rowHref: (r) => ctx.href('builder', { id: r.id }, { panel: 'page-settings' }),
                                columns: [
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
                                ],
                              },
                            )}`,
                          })
                        : null,
                      h(DataTable, {
                        columns: [
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
                              priority: field.name === 'title' ? 'primary' : 'secondary',
                              cell: (row) =>
                                ['schema', 'items'].includes(field.name)
                                  ? (field.name === 'items' ? menuItems(row.items) : formFields(row.schema))
                                      .length
                                  : field.kind.startsWith('select:')
                                    ? row[field.name] == null
                                      ? '—'
                                      : ctx.tr(`website.option.${row[field.name]}`)
                                    : (row[field.name] ?? '—'),
                            })),
                          ...(kind === 'taxonomy-sets'
                            ? ['termCount']
                            : ['menus', 'themes', 'seo'].includes(kind)
                              ? ['state']
                              : []
                          ).map((key) => ({
                            key,
                            label: ctx.tr(`website.resource.meta.${key}`),
                            cell: (r) =>
                              key === 'scan'
                                ? ctx.tr(`website.option.${r[key]}`)
                                : key === 'state'
                                  ? ctx.tr(`website.entry.state.${r[key]}`)
                                  : (r[key] ?? '—'),
                          })),
                        ],
                        rows: data.rows,
                        id: (row) => row.id,
                        rowHref: (row) =>
                          kind === 'sites'
                            ? ctx.href('overview', {}, { site: row.id })
                            : ctx.href(editKey, { id: row.id }),
                        emptyTitle: ctx.tr('website.resource.empty'),
                        emptyMessage: ctx.tr('website.resource.emptyHelp'),
                      }),
                    ],
                  }),
        }),
    }
    let current = null
    let pendingId = null
    let pendingDraft = null
    const structuredField = kind === 'menus' ? 'items' : kind === 'form-editor' ? 'schema' : null
    const isMenu = kind === 'menus'
    const readValues = (form) => {
      const values = Object.fromEntries(
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
          const get = (name) => String(form.get(`row-${index}-${name}`) ?? '').trim()
          const id = get('id')
          return isMenu
            ? {
                id,
                label: get('label'),
                href: get('target'),
                parentId: get('parent') || null,
                position: index,
              }
            : {
                id,
                name: get('key'),
                label: get('label'),
                type: get('type'),
                required: get('requirement') === 'required',
                maxLength: Number(get('maxLength')),
                classification: get('classification'),
              }
        })
        const order = form.get('__order')
          ? JSON.parse(String(form.get('__order')))
          : rows.map((row) => row.id)
        const byId = new Map(rows.map((row) => [row.id, row]))
        const ordered = order.map((id, position) => {
          const row = byId.get(id) ?? (isMenu ? newMenuItem(id) : newFormField(id))
          return isMenu
            ? { ...row, position, parentId: order.includes(row.parentId) ? row.parentId : null }
            : row
        })
        values[structuredField] = isMenu ? ordered : { fields: ordered }
      }
      return values
    }
    const rowsEditor = (data) => {
      const rows = isMenu ? menuItems(data.items) : formFields(data.schema)
      const names = isMenu
        ? ['label', 'target', 'parent']
        : ['key', 'label', 'type', 'requirement', 'maxLength', 'classification']
      const disabled = !ctx.can(schema.capability)
      const fieldControl = (row, index, name) => {
        const props = {
          id: `row-${index}-${name}`,
          name: `row-${index}-${name}`,
          disabled,
          label: ctx.tr(`website.resource.row.${name}`),
          value:
            {
              key: row.name,
              target: row.href,
              parent: row.parentId ?? '',
              requirement: row.required ? 'required' : 'optional',
            }[name] ??
            row[name] ??
            '',
        }
        if (name === 'parent')
          return h(Select, {
            ...props,
            label: ctx.tr('website.resource.menuParent'),
            options: [
              { value: '', label: ctx.tr('website.resource.noMenuParent') },
              ...rows
                .filter((r) => r.id !== row.id)
                .map((r) => ({ value: r.id, label: r.label || ctx.tr('website.resource.untitledRow') })),
            ],
          })
        const options = {
          classification: ['public', 'personal', 'sensitive'],
          requirement: ['required', 'optional'],
          type: ['text', 'email', 'tel', 'number', 'textarea', 'checkbox'],
        }[name]
        if (options) {
          const prefix = {
            classification: 'website.formClass.',
            requirement: 'website.resource.',
            type: 'website.fieldType.',
          }[name]
          return h(Select, {
            ...props,
            label: ctx.tr(
              {
                classification: 'website.resource.row.classification',
                requirement: 'website.resource.requirement',
                type: 'website.resource.fieldType',
              }[name],
            ),
            options: options.map((value) => ({ value, label: ctx.tr(prefix + value) })),
          })
        }
        return h(TextField, { ...props, type: name === 'maxLength' ? 'number' : 'text' })
      }
      const list = h(ReorderList, {
        id: `resource-rows-${kind}`,
        name: '__order',
        label: ctx.tr('website.resource.rows'),
        disabled,
        labels: {
          add: ctx.tr('website.resource.addRow'),
          remove: ctx.tr('website.resource.removeRow'),
          up: ctx.tr('website.resource.upRow'),
          down: ctx.tr('website.resource.downRow'),
          drag: ctx.tr('website.resource.dragRow'),
          empty: ctx.tr('website.resource.emptyRows'),
        },
        items: rows.map((row, index) => ({
          id: row.id,
          content: html`<input type="hidden" name=${`row-${index}-id`} value=${row.id} />${
            isMenu
              ? h(Grid, { columns: 2, items: names.map((name) => fieldControl(row, index, name)) })
              : html`<div class="website-form-config">
                  ${fragments(['label', 'type', 'requirement'].map((name) => html`<div class="website-form-field">${fieldControl(row, index, name)}</div>`))}
                  <input type="hidden" name=${`row-${index}-key`} value=${row.name || newFormField(row.id).name} />
                  <input type="hidden" name=${`row-${index}-maxLength`} value=${row.maxLength} />
                  <input type="hidden" name=${`row-${index}-classification`} value=${row.classification} />
                </div>`
          }`,
        })),
      })
      // ReorderList has no icon slot yet; reuse the exact canonical glyph used by the builder.
      const grip = `url("data:image/svg+xml,${encodeURIComponent(icon('grip-vertical').html)}")`
      return html`<input type="hidden" name="__rows" value=${rows.length} />${isMenu ? list : html`<div class="website-form-reorder" style=${`--website-reorder-grip: ${grip}`}>${list}</div>`}`
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
          current = await ctx.call(
            'website_studio.getResource',
            { siteId: ctx.site().id, kind, id: route.params.id },
            { signal },
          )
        if (kind === 'taxonomy') {
          const choices = await ctx.call(
            'website_studio.listResources',
            { siteId: ctx.site().id, kind },
            { signal },
          )
          current.sets = (
            await ctx.call(
              'website_studio.listResources',
              { siteId: ctx.site().id, kind: 'taxonomy-sets' },
              { signal },
            )
          ).rows
          if (!current.taxonomyId) current.taxonomyId = current.sets[0]?.id ?? ''
          current.parents = choices.rows.filter(
            (r) =>
              r.id !== current.id && r.taxonomyType === 'category' && r.taxonomyId === current.taxonomyId,
          )
        }
        return pendingDraft?.id === current.id ? { ...current, ...pendingDraft.values } : current
      },
      view: (data) =>
        kind === 'form-editor'
          ? formEditorView(ctx, data, schema, rowsEditor(data), async (form) => {
              pendingDraft = { id: current.id, values: readValues(form) }
              await ctx.refresh()
            })
          : h(RecordPage, {
              width: 'wide',
              title: data.title ?? title(),
              actions: html`${h(LinkButton, { label: ctx.tr('website.resource.back'), href: ctx.href(kind === 'form-editor' ? 'forms' : kind) })}${kind === 'themes' && data.affected?.[0]?.id ? h(LinkButton, { label: ctx.tr('website.builder.preview'), href: ctx.href('builder', { id: data.affected[0].id }, { panel: 'styles' }) }) : null}${CommandButton({ label: ctx.tr(kind === 'form-editor' && data.revisionId ? 'website.formJourney.newVersion' : 'website.action.save'), command: `resource.${kind}.save`, type: 'submit', form: `resource-${kind}`, variant: 'primary', disabled: ctx.busy() || !ctx.can(schema.capability) })}${data.revisionId && !['sites', 'domains'].includes(kind) ? ArchiveActions(ctx, { id: `resource-${kind}-archive`, title: data.title ?? title(), command: `resource.${kind}.archive`, disabled: ctx.busy() || !ctx.can(schema.capability), usage: data.usage, extraItems: [] }) : null}`,
              body: h(Surface, {
                title: ctx.tr('website.resource.details'),
                body: h(Stack, {
                  items: [
                    data.kind === 'themes'
                      ? h(Notice, {
                          title: `${ctx.tr('website.resource.version')} ${data.version ?? ''}`,
                          message: ctx.tr('website.resource.themeCompatibility', {
                            count: data.compatibility?.length ?? 0,
                          }),
                          tone: 'info',
                        })
                      : null,
                    data.kind === 'menus'
                      ? h(Stack, {
                          items: (data.warnings ?? []).map((w) =>
                            h(Notice, {
                              title: w.target,
                              message: ctx.tr(`website.menu.warning.${w.state}`),
                              tone: 'warning',
                            }),
                          ),
                        })
                      : null,
                    kind === 'taxonomy-sets' && data.revisionId
                      ? h(LinkButton, {
                          label: ctx.tr('website.resource.taxonomySet.terms'),
                          href: ctx.href('taxonomy', {}, { set: data.id }),
                        })
                      : null,
                    kind === 'domains'
                      ? h(Notice, {
                          title: title(),
                          message: ctx.tr('website.resource.domainHelp'),
                          tone: 'info',
                        })
                      : null,
                    html`<form data-reorder=${`resource.${kind}.reorder`} id=${`resource-${kind}`} novalidate>${h(
                      Stack,
                      {
                        items: [
                          h(Grid, {
                            columns: 2,
                            items: schema.fields
                              .filter((field) => field.name !== structuredField)
                              .map((field) => {
                                const props = {
                                  id: `${kind}-${field.name}`,
                                  name: field.name,
                                  label: ctx.tr(field.label),
                                  value: data[field.name] ?? field.defaultValue ?? '',
                                  required: field.required,
                                  disabled: !ctx.can(schema.capability),
                                }
                                if (kind === 'sites' && field.name === 'companyId')
                                  return h(Select, {
                                    ...props,
                                    value: data.companyId ?? ctx.boot().companies?.[0]?.id,
                                    options: (ctx.boot().companies ?? []).map((r) => ({
                                      value: r.id,
                                      label: r.name,
                                    })),
                                  })
                                if (kind === 'taxonomy' && field.name === 'taxonomyId')
                                  return h(Select, {
                                    ...props,
                                    options: (data.sets ?? []).map((r) => ({ value: r.id, label: r.title })),
                                  })
                                if (kind === 'taxonomy' && field.name === 'parent')
                                  return h(Select, {
                                    ...props,
                                    options: [
                                      { value: '', label: ctx.tr('website.resource.noParent') },
                                      ...(data.parents ?? []).map((r) => ({ value: r.id, label: r.title })),
                                    ],
                                  })
                                if (field.kind.startsWith('select:')) {
                                  const values = field.kind.slice(7).split(',')
                                  return h(Select, {
                                    ...props,
                                    value: data[field.name] ?? field.defaultValue ?? values[0],
                                    options: values.map((value) => ({
                                      value,
                                      label: ctx.tr(`website.option.${value}`),
                                    })),
                                  })
                                }
                                return h(field.kind === 'area' ? TextArea : TextField, {
                                  ...props,
                                  span: field.kind === 'area' ? 'full' : undefined,
                                })
                              }),
                          }),
                          structuredField ? rowsEditor(data) : null,
                        ],
                      },
                    )}</form>`,
                  ],
                }),
              }),
            }),
      commands: {
        [`resource.${kind}.archive`]: async (_args, form) => {
          await ctx.call('website_studio.archiveResource', {
            siteId: ctx.site().id,
            kind,
            id: current.id,
            expectedRevisionId: current.revisionId,
            confirmed: form.has('confirmed'),
          })
          pendingDraft = null
          await ctx.navigate(kind === 'form-editor' ? 'forms' : kind)
        },
        [`resource.${kind}.reorder`]: async (_args, form) => {
          pendingDraft = { id: current.id, values: readValues(form) }
          await ctx.refresh()
        },
        [`resource.${kind}.save`]: async (_args, form) => {
          const values = readValues(form)
          if (schema.fields.some((field) => field.required && !values[field.name]))
            throw Object.assign(new Error(ctx.tr('website.resource.validation')), { code: 'validation' })
          await ctx.call(
            'website_studio.saveResource',
            { siteId: ctx.site().id, kind, id: current.id, expectedRevisionId: current.revisionId, values },
            current.revisionId ? {} : { key: current.id },
          )
          pendingId = null
          pendingDraft = null
          if (kind === 'sites') await ctx.reload()
          ctx.notify(ctx.tr('website.resource.saved'))
          await ctx.navigate(kind === 'form-editor' ? 'forms' : kind)
        },
      },
    }
  }
  screens['menus-edit'] = createMenuEditor(ctx)
  return screens
}
