import { html, signal } from '@ketvietlab/ketjs-view'
import {
  RecordPage,
  Surface,
  Stack,
  Grid,
  TextField,
  Select,
  CheckboxGroup,
  Button,
  IconButton,
  LinkButton,
  Notice,
  Disclosure,
  EmptyState,
  ActionGroup,
} from '@ketvietlab/design-system'
import { h, CommandButton, fragments, icon } from '../ui.mjs'
import { ArchiveActions } from '../archive-actions.mjs'
import { menuIssues } from '../content-schema.mjs'
import { flattenMenu, menuBranch, moveMenu, stepMenu, removeMenuItem, planMenuDrop } from '../menu-order.mjs'
import { menuKeyboardMove, menuPointerDrag } from '../menu-drag.mjs'
import { newId } from './format.mjs'

export function createMenuEditor(ctx) {
  const tr = ctx.tr
  const version = signal(0)
  const touch = () => version.set((n) => n + 1)
  const editable = () => ctx.can('website.content.write') && !ctx.busy()
  let draft = null,
    loadedKey = null,
    choices = [],
    query = '',
    dragCleanup = () => {}
  const selected = new Set()
  const message = signal('')
  const change = (fn) => {
    if (editable()) {
      fn()
      touch()
    }
  }
  const error = () => Object.assign(new Error(tr('website.resource.validation')), { code: 'validation' })
  const mutateOrder = (fn) =>
    change(() => {
      draft.items = fn(draft.items)
    })
  const sourceLabel = (type) =>
    ({
      page: tr('website.route.pages'),
      post: tr('website.route.posts'),
      category: tr('website.route.categories'),
      tag: tr('website.route.tags'),
    })[type]
  const field = (name, label, value, onChange, extra = {}) =>
    html`<div class="website-menu-field website-form-field" on:input=${(e) => change(() => onChange(e.target.value))}>${h(TextField, { id: name, label, value, disabled: !editable(), ...extra })}</div>`
  const select = (name, label, value, options, onChange) =>
    html`<div class="website-menu-field website-form-field" on:change=${(e) => change(() => onChange(e.target.value))}>${h(Select, { id: name, label, value, options, disabled: !editable() })}</div>`
  const action = (label, fn, disabled = false) =>
    html`<span on:click=${fn}>${h(Button, { label, disabled: disabled || !editable(), size: 'compact' })}</span>`
  const addSelected = () =>
    change(() => {
      for (const row of choices.filter((item) => selected.has(item.key)))
        draft.items.push({
          id: newId('menu-item'),
          label: row.title,
          href: row.path,
          parentId: null,
          position: draft.items.length,
        })
      selected.clear()
    })
  let customLabel = '',
    customHref = ''
  const addCustom = () =>
    change(() => {
      const row = {
        id: newId('menu-item'),
        label: customLabel.trim(),
        href: customHref.trim(),
        parentId: null,
        position: draft.items.length,
      }
      if (menuIssues([row]).length) {
        message.set(tr('website.menuEditor.invalidLink'))
        return
      }
      draft.items.push(row)
      customLabel = ''
      customHref = ''
      message.set('')
    })
  const move = (id, target, mode) => mutateOrder((items) => moveMenu(items, id, target, mode))
  const step = (id, direction) => mutateOrder((items) => stepMenu(items, id, direction))
  const keyboard = (e, id) => {
    if (menuKeyboardMove(e, id, step)) message.set(tr('website.menuEditor.moved'))
  }
  const rowsView = () => {
    const rows = flattenMenu(draft.items)
    return rows.length
      ? h(Stack, {
          divided: true,
          gap: 'compact',
          items: rows.map((item) => {
            const branch = menuBranch(draft.items, item.id)
            const siblings = rows.filter((row) => (row.parentId || null) === (item.parentId || null))
            const at = siblings.findIndex((row) => row.id === item.id)
            const changeParent = (parentId) => {
              if (parentId) draft.items = moveMenu(draft.items, item.id, parentId, 'inside')
              else {
                const ancestor = rows.find((row) => row.id === item.parentId)
                if (ancestor) {
                  let root = ancestor
                  while (root.parentId) root = rows.find((row) => row.id === root.parentId)
                  draft.items = moveMenu(draft.items, item.id, root.id, 'after')
                }
              }
            }
            return html`<div class="website-menu-item" data-menu-item=${item.id} data-menu-label=${item.label} style=${`--menu-depth: ${item.depth}`}>
        <div class="website-menu-row">
          <span class="website-menu-grip" on:keydown=${(e) => keyboard(e, item.id)} on:pointerdown=${(e) => {
            if (!editable()) return
            dragCleanup()
            const status = e.currentTarget
              .closest('[data-menu-editor]')
              .querySelector('[data-menu-announcement]')
            dragCleanup = menuPointerDrag(
              e,
              item.id,
              (id, target) => !menuBranch(draft.items, id).has(target),
              move,
              (mode, name) => {
                if (status)
                  status.textContent = mode
                    ? tr('website.menuEditor.drop', {
                        mode: {
                          before: tr('website.menuEditor.before'),
                          after: tr('website.menuEditor.after'),
                          inside: tr('website.menuEditor.inside'),
                        }[mode],
                        name,
                      })
                    : ''
              },
              (target, mode, deltaX) => planMenuDrop(draft.items, item.id, target, mode, deltaX),
            )
          }}>${h(IconButton, { label: tr('website.menuEditor.drag', { name: item.label }), icon: icon('grip-vertical'), disabled: !editable(), describedBy: 'menu-drag-help' })}</span>
          ${h(Disclosure, {
            summary: item.label || tr('website.resource.untitledRow'),
            body: h(Stack, {
              items: [
                field(
                  `menu-label-${item.id}`,
                  tr('website.resource.row.label'),
                  item.label,
                  (value) => {
                    draft.items.find((row) => row.id === item.id).label = value
                  },
                  { required: true },
                ),
                field(
                  `menu-href-${item.id}`,
                  tr('website.resource.row.target'),
                  item.href,
                  (value) => {
                    draft.items.find((row) => row.id === item.id).href = value
                  },
                  { required: true },
                ),
                select(
                  `menu-parent-${item.id}`,
                  tr('website.resource.menuParent'),
                  item.parentId ?? '',
                  [
                    { value: '', label: tr('website.resource.noMenuParent') },
                    ...rows
                      .filter((row) => !branch.has(row.id))
                      .map((row) => ({ value: row.id, label: row.label })),
                  ],
                  changeParent,
                ),
                h(ActionGroup, {
                  actions: [
                    action(tr('website.resource.upRow'), () => step(item.id, 'up'), at === 0),
                    action(
                      tr('website.resource.downRow'),
                      () => step(item.id, 'down'),
                      at === siblings.length - 1,
                    ),
                    action(tr('website.menuEditor.indent'), () => step(item.id, 'in'), at === 0),
                    action(tr('website.menuEditor.outdent'), () => step(item.id, 'out'), !item.parentId),
                    action(tr('website.resource.removeRow'), () =>
                      mutateOrder((items) => removeMenuItem(items, item.id)),
                    ),
                  ],
                }),
                item.depth || branch.size > 1
                  ? html`<small>${tr('website.menuEditor.removeHelp')}</small>`
                  : null,
              ],
            }),
          })}
        </div>
      </div>`
          }),
        })
      : h(EmptyState, { title: tr('website.menuEditor.empty'), message: tr('website.menuEditor.emptyHelp') })
  }
  return {
    readKey: (route) => route.params.id,
    read: async (route, signal) => {
      const key = `${ctx.site().id}:${route.params.id}`
      if (loadedKey === key && draft) return draft
      const [resource, pages, posts, taxonomy] = await Promise.all([
        route.params.id === 'new'
          ? {
              id: newId('menus'),
              revisionId: null,
              title: '',
              locale: ctx.site().locales?.[0] ?? 'vi',
              position: 'header',
              items: [],
            }
          : ctx.call(
              'website_studio.getResource',
              { siteId: ctx.site().id, kind: 'menus', id: route.params.id },
              { signal },
            ),
        ctx.call('website.listEntries', { siteId: ctx.site().id, type: 'page' }, { signal }),
        ctx.call('website.listEntries', { siteId: ctx.site().id, type: 'post' }, { signal }),
        ctx.call('website_studio.listResources', { siteId: ctx.site().id, kind: 'taxonomy' }, { signal }),
      ])
      choices = [
        ...pages.rows.map((row) => ({ ...row, type: 'page' })),
        ...posts.rows.map((row) => ({ ...row, type: 'post' })),
        ...taxonomy.rows.map((row) => ({
          ...row,
          type: row.taxonomyType ?? 'category',
          path: `/${row.taxonomyType === 'tag' ? 'tag' : 'category'}/${row.slug}`,
        })),
      ].map((row) => ({ ...row, key: `${row.type}:${row.id}` }))
      draft = structuredClone(resource)
      draft.items ??= []
      loadedKey = key
      selected.clear()
      query = ''
      customLabel = ''
      customHref = ''
      message.set('')
      return draft
    },
    view: () => {
      version()
      const filtered = choices.filter((row) =>
        `${row.title} ${row.path}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi')),
      )
      return h(RecordPage, {
        width: 'wide',
        variant: 'operational',
        title: draft.title || tr('website.menuEditor.new'),
        actions: fragments([
          h(LinkButton, { label: tr('website.resource.back'), href: ctx.href('menus') }),
          CommandButton({
            label: tr('website.builder.save'),
            command: 'menu.save',
            variant: 'primary',
            disabled: !editable(),
          }),
          draft.revisionId && draft.archivable !== false
            ? ArchiveActions(ctx, {
                id: 'menu-archive',
                title: draft.title,
                command: 'menu.archive',
                disabled: !editable(),
              })
            : null,
        ]),
        body: html`<div data-menu-editor="">${h(Stack, {
          items: [
            h(Surface, {
              title: tr('website.menuEditor.settings'),
              body: h(Grid, {
                columns: 3,
                items: [
                  field(
                    'menu-title',
                    tr('website.resource.menus.title'),
                    draft.title,
                    (value) => {
                      draft.title = value
                    },
                    { required: true },
                  ),
                  select(
                    'menu-position',
                    tr('website.resource.menus.position'),
                    draft.position ?? 'header',
                    [
                      { value: 'header', label: tr('website.option.header') },
                      { value: 'footer', label: tr('website.option.footer') },
                    ],
                    (value) => {
                      draft.position = value
                    },
                  ),
                  select(
                    'menu-locale',
                    tr('website.entry.locale'),
                    draft.locale ?? 'vi',
                    (ctx.site().locales ?? ['vi', 'en']).map((value) => ({
                      value,
                      label: value.toUpperCase(),
                    })),
                    (value) => {
                      draft.locale = value
                    },
                  ),
                ],
              }),
            }),
            html`<div class="website-menu-workspace">
            <div class="website-menu-picker">${h(Surface, {
              title: tr('website.menuEditor.add'),
              body: h(Stack, {
                items: [
                  html`<div class="website-menu-field website-form-field" on:input=${(e) => {
                    query = e.target.value
                    touch()
                  }}>${h(TextField, { id: 'menu-search', label: tr('website.menuEditor.search'), value: query, type: 'search' })}</div>`,
                  action(tr('website.menuEditor.addSelected'), addSelected, selected.size === 0),
                  ...['page', 'post', 'category', 'tag'].map((type) =>
                    h(Disclosure, {
                      summary: sourceLabel(type),
                      open: type === 'page' || !!query,
                      body: html`<div class="website-menu-sources website-form-field" on:change=${(e) => {
                        if (!editable()) return
                        if (e.target.checked) selected.add(e.target.value)
                        else selected.delete(e.target.value)
                        touch()
                      }}>${
                        filtered.some((row) => row.type === type)
                          ? h(CheckboxGroup, {
                              id: `menu-source-${type}`,
                              name: `menu-source-${type}`,
                              label: tr('website.menuEditor.choose'),
                              disabled: !editable(),
                              optionsOrientation: 'vertical',
                              options: filtered
                                .filter((row) => row.type === type)
                                .map((row) => ({
                                  value: row.key,
                                  label: row.title,
                                  checked: selected.has(row.key),
                                })),
                            })
                          : html`<small>${tr('website.menuEditor.noSources')}</small>`
                      }</div>`,
                    }),
                  ),
                  h(Disclosure, {
                    summary: tr('website.menuEditor.custom'),
                    body: h(Stack, {
                      items: [
                        field('menu-custom-title', tr('website.resource.row.label'), customLabel, (value) => {
                          customLabel = value
                        }),
                        field(
                          'menu-custom-href',
                          tr('website.resource.row.target'),
                          customHref,
                          (value) => {
                            customHref = value
                          },
                          { placeholder: 'https://…' },
                        ),
                        action(tr('website.menuEditor.addLink'), addCustom),
                      ],
                    }),
                  }),
                ],
              }),
            })}</div>
            <div class="website-menu-structure">${h(Surface, { title: tr('website.menuEditor.structure'), description: tr('website.menuEditor.instructions'), body: html`<p id="menu-drag-help" class="website-menu-help">${tr('website.menuEditor.keyboard')}</p>${rowsView()}` })}</div>
          </div>`,
            ...(draft.warnings ?? []).map((w) =>
              h(Notice, { title: w.target, message: tr(`website.menu.warning.${w.state}`), tone: 'warning' }),
            ),
            html`<p role="status" aria-live="polite" data-menu-announcement="">${message()}</p>`,
          ],
        })}</div>`,
      })
    },
    commands: {
      'menu.save': async () => {
        if (!ctx.can('website.content.write'))
          throw Object.assign(new Error(tr('website.resource.validation')), { code: 'permission' })
        if (!draft.title?.trim() || menuIssues(draft.items).length) throw error()
        const values = {
          title: draft.title.trim(),
          locale: draft.locale ?? 'vi',
          position: draft.position ?? 'header',
          items: flattenMenu(draft.items).map(({ depth: _depth, ...item }, position) => ({
            ...item,
            position,
          })),
        }
        await ctx.call(
          'website_studio.saveResource',
          {
            siteId: ctx.site().id,
            kind: 'menus',
            id: draft.id,
            expectedRevisionId: draft.revisionId,
            values,
          },
          draft.revisionId ? {} : { key: draft.id },
        )
        loadedKey = null
        ctx.notify(tr('website.resource.saved'))
        await ctx.navigate('menus')
      },
      'menu.archive': async (_args, form) => {
        await ctx.call('website_studio.archiveResource', {
          siteId: ctx.site().id,
          kind: 'menus',
          id: draft.id,
          expectedRevisionId: draft.revisionId,
          confirmed: form.has('confirmed'),
        })
        loadedKey = null
        await ctx.navigate('menus')
      },
    },
    dispose: () => dragCleanup(),
  }
}
