import { signal } from '@ketvietlab/ketjs-view'
import {
  RecordPage,
  Surface,
  Stack,
  Grid,
  TextField,
  Select,
  CheckboxGroup,
  Button,
  Field,
  IconButton,
  LinkButton,
  Notice,
  Disclosure,
  EmptyState,
  ActionGroup,
} from '@ketvietlab/design-system'
import { CommandButton, fragments, icon } from '../ui.tsx'
import { ArchiveActions } from '../archive-actions.tsx'
import { menuIssues } from '../content-schema.ts'
import { flattenMenu, menuBranch, moveMenu, stepMenu, removeMenuItem, planMenuDrop } from '../menu-order.ts'
import { menuKeyboardMove, menuPointerDrag } from '../menu-drag.ts'
import { newId } from './format.ts'
import type { FieldOption } from '@ketvietlab/design-system'
import type { MenuPlacement } from '../menu-order.ts'
import type { Commands, MenuItem, Screen, StudioContext, TaxonomyTerm } from '../types.ts'

/** A menu as `website_studio.getResource` answers it; a new one has no revision yet. */
export type MenuDraft = {
  id: string
  revisionId: string | null
  title: string
  locale?: string
  position?: string
  items: MenuItem[]
  archivable?: boolean
  /** Links whose target no longer resolves, and why. */
  warnings?: { target: string; state: string }[]
}
/** Something the site already has that a menu can link to. */
type MenuChoice = {
  id: string
  title: string
  path: string
  type: string
  key: string
  catalogCategoryId?: string
}
type EntryRow = { id: string; title: string; path: string }
type MenuEditorScreen = Screen<MenuDraft> & {
  commands: Commands
  dispose(): void
}

export function createMenuEditor(ctx: StudioContext): MenuEditorScreen {
  const tr = ctx.tr
  const version = signal(0)
  const touch = () => version.set((n) => n + 1)
  const editable = () => ctx.can('website.content.write') && !ctx.busy()
  let draft: MenuDraft | null = null,
    loadedKey: string | null = null,
    choices: MenuChoice[] = [],
    query = '',
    dragCleanup = () => {}
  const selected = new Set<string>()
  const message = signal('')
  const change = (fn: () => void) => {
    if (editable()) {
      fn()
      touch()
    }
  }
  const error = () =>
    Object.assign(new Error(tr('website.resource.validation')), {
      code: 'validation',
    })
  const mutateOrder = (fn: (items: MenuItem[]) => MenuItem[]) =>
    change(() => {
      draft!.items = fn(draft!.items)
    })
  const sourceLabel = (type: string) =>
    (
      ({
        page: tr('website.route.pages'),
        post: tr('website.route.posts'),
        category: tr('website.route.categories'),
        tag: tr('website.route.tags'),
        productCategory: tr('website.catalogCategory.categories'),
        collection: tr('website.catalogCategory.collections'),
      }) as Record<string, string>
    )[type]
  // These controls edit the draft as they change; nothing submits them, so the name only labels them.
  const field = (
    name: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    extra: { required?: boolean; placeholder?: string } = {},
  ) => (
    <div
      class="website-menu-field website-form-field"
      onInput={(e: Event) => change(() => onChange((e.target as HTMLInputElement).value))}
    >
      <TextField id={name} name={name} label={label} value={value} disabled={!editable()} {...extra} />
    </div>
  )
  const select = (
    name: string,
    label: string,
    value: string,
    options: FieldOption[],
    onChange: (value: string) => void,
  ) => (
    <div
      class="website-menu-field website-form-field"
      onChange={(e: Event) => change(() => onChange((e.target as HTMLSelectElement).value))}
    >
      <Select id={name} name={name} label={label} value={value} options={options} disabled={!editable()} />
    </div>
  )
  const action = (label: string, fn: () => void, disabled = false) => (
    // biome-ignore lint/a11y/noStaticElementInteractions: Delegates clicks from native buttons, which already handle Enter and Space.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Delegates clicks from native buttons, which already handle Enter and Space.
    <span onClick={fn}>
      <Button label={label} disabled={disabled || !editable()} size="compact" />
    </span>
  )
  const addSelected = () =>
    change(() => {
      for (const row of choices.filter((item) => selected.has(item.key)))
        draft!.items.push({
          id: newId('menu-item'),
          label: row.title,
          href: row.path,
          ...(row.catalogCategoryId ? { catalogCategoryId: row.catalogCategoryId } : {}),
          parentId: null,
          position: draft!.items.length,
        })
      selected.clear()
    })
  let customLabel = '',
    customHref = ''
  const addCustom = () =>
    change(() => {
      const row: MenuItem = {
        id: newId('menu-item'),
        label: customLabel.trim(),
        href: customHref.trim(),
        parentId: null,
        position: draft!.items.length,
      }
      if (menuIssues([row]).length) {
        message.set(tr('website.menuEditor.invalidLink'))
        return
      }
      draft!.items.push(row)
      customLabel = ''
      customHref = ''
      message.set('')
    })
  const move = (id: string, target: string, mode: MenuPlacement) =>
    mutateOrder((items) => moveMenu(items, id, target, mode))
  const step = (id: string, direction: 'up' | 'down' | 'in' | 'out') =>
    mutateOrder((items) => stepMenu(items, id, direction))
  const keyboard = (e: KeyboardEvent, id: string) => {
    if (menuKeyboardMove(e, id, step)) message.set(tr('website.menuEditor.moved'))
  }
  const rowsView = () => {
    const rows = flattenMenu(draft!.items)
    return rows.length ? (
      <Stack
        divided
        gap="compact"
        items={rows.map((item) => {
          const branch = menuBranch(draft!.items, item.id)
          const siblings = rows.filter((row) => (row.parentId || null) === (item.parentId || null))
          const at = siblings.findIndex((row) => row.id === item.id)
          const changeParent = (parentId: string) => {
            if (parentId) draft!.items = moveMenu(draft!.items, item.id, parentId, 'inside')
            else {
              const ancestor = rows.find((row) => row.id === item.parentId)
              if (ancestor) {
                let root = ancestor
                while (root.parentId) {
                  const parentId: string = root.parentId
                  root = rows.find((row) => row.id === parentId)!
                }
                draft!.items = moveMenu(draft!.items, item.id, root.id, 'after')
              }
            }
          }
          return (
            <div
              class="website-menu-item"
              data-menu-item={item.id}
              data-menu-label={item.label}
              style={`--menu-depth: ${item.depth}`}
            >
              <div class="website-menu-row">
                {/* biome-ignore lint/a11y/noStaticElementInteractions: Delegates key and pointer events from the grip's native button. */}
                <span
                  class="website-menu-grip"
                  onKeyDown={(e: KeyboardEvent) => keyboard(e, item.id)}
                  onPointerDown={(e: PointerEvent) => {
                    if (!editable()) return
                    dragCleanup()
                    const status = (e.currentTarget as Element)
                      .closest('[data-menu-editor]')!
                      .querySelector('[data-menu-announcement]')
                    dragCleanup = menuPointerDrag(
                      e,
                      item.id,
                      (id, target) => !menuBranch(draft!.items, id).has(target),
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
                                name: name!,
                              })
                            : ''
                      },
                      (target, mode, deltaX) => planMenuDrop(draft!.items, item.id, target, mode, deltaX),
                    )
                  }}
                >
                  <IconButton
                    label={tr('website.menuEditor.drag', { name: item.label })}
                    icon={icon('grip-vertical')}
                    disabled={!editable()}
                    describedBy="menu-drag-help"
                  />
                </span>
                <Disclosure
                  summary={item.label || tr('website.resource.untitledRow')}
                  body={
                    <Stack
                      items={[
                        field(
                          `menu-label-${item.id}`,
                          tr('website.resource.row.label'),
                          item.label,
                          (value) => {
                            draft!.items.find((row) => row.id === item.id)!.label = value
                          },
                          { required: true },
                        ),
                        field(
                          `menu-href-${item.id}`,
                          tr('website.resource.row.target'),
                          item.href,
                          (value) => {
                            const row = draft!.items.find((row) => row.id === item.id)!
                            row.href = value
                            delete row.catalogCategoryId
                          },
                          { required: true },
                        ),
                        select(
                          `menu-parent-${item.id}`,
                          tr('website.resource.menuParent'),
                          item.parentId ?? '',
                          [
                            {
                              value: '',
                              label: tr('website.resource.noMenuParent'),
                            },
                            ...rows
                              .filter((row) => !branch.has(row.id))
                              .map((row) => ({
                                value: row.id,
                                label: row.label,
                              })),
                          ],
                          changeParent,
                        ),
                        <ActionGroup
                          actions={[
                            action(tr('website.resource.upRow'), () => step(item.id, 'up'), at === 0),
                            action(
                              tr('website.resource.downRow'),
                              () => step(item.id, 'down'),
                              at === siblings.length - 1,
                            ),
                            action(tr('website.menuEditor.indent'), () => step(item.id, 'in'), at === 0),
                            action(
                              tr('website.menuEditor.outdent'),
                              () => step(item.id, 'out'),
                              !item.parentId,
                            ),
                            action(tr('website.resource.removeRow'), () =>
                              mutateOrder((items) => removeMenuItem(items, item.id)),
                            ),
                          ]}
                        />,
                        item.depth || branch.size > 1 ? (
                          <small>{tr('website.menuEditor.removeHelp')}</small>
                        ) : null,
                      ]}
                    />
                  }
                />
              </div>
            </div>
          )
        })}
      />
    ) : (
      <EmptyState title={tr('website.menuEditor.empty')} message={tr('website.menuEditor.emptyHelp')} />
    )
  }
  return {
    readKey: (route) => route.params.id,
    read: async (route, signal) => {
      const key = `${ctx.site().id}:${route.params.id}`
      if (loadedKey === key && draft) return draft
      const [resource, pages, posts, taxonomy, catalog] = await Promise.all([
        route.params.id === 'new'
          ? {
              id: newId('menus'),
              revisionId: null,
              title: '',
              locale: ctx.site().locales?.[0] ?? 'vi',
              position: 'header',
              items: [],
            }
          : ctx.call<MenuDraft>(
              'website_studio.getResource',
              { siteId: ctx.site().id, kind: 'menus', id: route.params.id },
              { signal },
            ),
        ctx.call<{ rows: EntryRow[] }>(
          'website.listEntries',
          { siteId: ctx.site().id, type: 'page' },
          { signal },
        ),
        ctx.call<{ rows: EntryRow[] }>(
          'website.listEntries',
          { siteId: ctx.site().id, type: 'post' },
          { signal },
        ),
        ctx.call<{ rows: TaxonomyTerm[] }>(
          'website_studio.listResources',
          { siteId: ctx.site().id, kind: 'taxonomy' },
          { signal },
        ),
        ctx.can('website.catalog')
          ? ctx.call<{ rows: { id: string; title: string; path: string; kind: string }[] }>(
              'website_catalog.listCategories',
              { siteId: ctx.site().id },
              { signal },
            )
          : Promise.resolve({ rows: [] }),
      ])
      choices = [
        ...pages.rows.map((row) => ({ ...row, type: 'page' })),
        ...posts.rows.map((row) => ({ ...row, type: 'post' })),
        ...taxonomy.rows.map((row) => ({
          ...row,
          // A listed term always has a title; only a new, unsaved one lacks it.
          title: row.title as string,
          type: row.taxonomyType ?? 'category',
          path: `/${row.taxonomyType === 'tag' ? 'tag' : 'category'}/${row.slug}`,
        })),
        ...catalog.rows.map((row) => ({
          ...row,
          catalogCategoryId: row.id,
          type: row.kind === 'collection' ? 'collection' : 'productCategory',
        })),
      ].map((row) => ({ ...row, key: `${row.type}:${row.id}` }))
      draft = structuredClone(resource) as MenuDraft
      draft!.items ??= []
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
      return (
        <RecordPage
          width="wide"
          variant="operational"
          title={draft!.title || tr('website.menuEditor.new')}
          actions={fragments([
            <LinkButton label={tr('website.resource.back')} href={ctx.href('menus')} />,
            <CommandButton
              label={tr('website.builder.save')}
              command="menu.save"
              variant="primary"
              disabled={!editable()}
            />,
            draft!.revisionId && draft!.archivable !== false
              ? ArchiveActions(ctx, {
                  id: 'menu-archive',
                  title: draft!.title,
                  command: 'menu.archive',
                  disabled: !editable(),
                })
              : null,
          ])}
          body={
            <div data-menu-editor="">
              <Stack
                items={[
                  <Surface
                    title={tr('website.menuEditor.settings')}
                    body={
                      <Grid
                        columns={3}
                        items={[
                          field(
                            'menu-title',
                            tr('website.resource.menus.title'),
                            draft!.title,
                            (value) => {
                              draft!.title = value
                            },
                            { required: true },
                          ),
                          select(
                            'menu-position',
                            tr('website.resource.menus.position'),
                            draft!.position ?? 'header',
                            [
                              {
                                value: 'header',
                                label: tr('website.option.header'),
                              },
                              {
                                value: 'footer',
                                label: tr('website.option.footer'),
                              },
                            ],
                            (value) => {
                              draft!.position = value
                            },
                          ),
                          select(
                            'menu-locale',
                            tr('website.entry.locale'),
                            draft!.locale ?? 'vi',
                            (ctx.site().locales ?? ['vi', 'en']).map((value) => ({
                              value,
                              label: value.toUpperCase(),
                            })),
                            (value) => {
                              draft!.locale = value
                            },
                          ),
                        ]}
                      />
                    }
                  />,
                  <div class="website-menu-workspace">
                    <div class="website-menu-picker">
                      <Surface
                        title={tr('website.menuEditor.add')}
                        body={
                          <Stack
                            items={[
                              <div
                                class="website-menu-field website-form-field"
                                onInput={(e: Event) => {
                                  query = (e.target as HTMLInputElement).value
                                  touch()
                                }}
                              >
                                <Field
                                  id="menu-search"
                                  name="menu-search"
                                  label={tr('website.menuEditor.search')}
                                  value={query}
                                  type="search"
                                />
                              </div>,
                              action(tr('website.menuEditor.addSelected'), addSelected, selected.size === 0),
                              ...['page', 'post', 'category', 'tag', 'productCategory', 'collection'].map(
                                (type) => (
                                  <Disclosure
                                    summary={sourceLabel(type)}
                                    open={type === 'page' || !!query}
                                    body={
                                      <div
                                        class="website-menu-sources website-form-field"
                                        onChange={(e: Event) => {
                                          if (!editable()) return
                                          const box = e.target as HTMLInputElement
                                          if (box.checked) selected.add(box.value)
                                          else selected.delete(box.value)
                                          touch()
                                        }}
                                      >
                                        {filtered.some((row) => row.type === type) ? (
                                          <CheckboxGroup
                                            id={`menu-source-${type}`}
                                            name={`menu-source-${type}`}
                                            label={tr('website.menuEditor.choose')}
                                            disabled={!editable()}
                                            optionsOrientation="vertical"
                                            options={filtered
                                              .filter((row) => row.type === type)
                                              .map((row) => ({
                                                value: row.key,
                                                label: row.title,
                                                checked: selected.has(row.key),
                                              }))}
                                          />
                                        ) : (
                                          <small>{tr('website.menuEditor.noSources')}</small>
                                        )}
                                      </div>
                                    }
                                  />
                                ),
                              ),
                              <Disclosure
                                summary={tr('website.menuEditor.custom')}
                                body={
                                  <Stack
                                    items={[
                                      field(
                                        'menu-custom-title',
                                        tr('website.resource.row.label'),
                                        customLabel,
                                        (value) => {
                                          customLabel = value
                                        },
                                      ),
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
                                    ]}
                                  />
                                }
                              />,
                            ]}
                          />
                        }
                      />
                    </div>
                    <div class="website-menu-structure">
                      <Surface
                        title={tr('website.menuEditor.structure')}
                        description={tr('website.menuEditor.instructions')}
                        body={
                          <>
                            <p id="menu-drag-help" class="website-menu-help">
                              {tr('website.menuEditor.keyboard')}
                            </p>
                            {rowsView()}
                          </>
                        }
                      />
                    </div>
                  </div>,
                  ...(draft!.warnings ?? []).map((w) => (
                    <Notice title={w.target} message={tr(`website.menu.warning.${w.state}`)} tone="warning" />
                  )),
                  <p role="status" aria-live="polite" data-menu-announcement="">
                    {message()}
                  </p>,
                ]}
              />
            </div>
          }
        />
      )
    },
    commands: {
      'menu.save': async () => {
        if (!ctx.can('website.content.write'))
          throw Object.assign(new Error(tr('website.resource.validation')), {
            code: 'permission',
          })
        if (!draft!.title?.trim() || menuIssues(draft!.items).length) throw error()
        const values = {
          title: draft!.title.trim(),
          locale: draft!.locale ?? 'vi',
          position: draft!.position ?? 'header',
          items: flattenMenu(draft!.items).map(({ depth: _depth, ...item }, position) => ({
            ...item,
            position,
          })),
        }
        await ctx.call(
          'website_studio.saveResource',
          {
            siteId: ctx.site().id,
            kind: 'menus',
            id: draft!.id,
            expectedRevisionId: draft!.revisionId,
            values,
          },
          draft!.revisionId ? {} : { key: draft!.id },
        )
        loadedKey = null
        ctx.notify(tr('website.resource.saved'))
        await ctx.navigate('menus')
      },
      'menu.archive': async (_args, form) => {
        form = form!
        await ctx.call('website_studio.archiveResource', {
          siteId: ctx.site().id,
          kind: 'menus',
          id: draft!.id,
          expectedRevisionId: draft!.revisionId,
          confirmed: form.has('confirmed'),
        })
        loadedKey = null
        await ctx.navigate('menus')
      },
    },
    dispose: () => dragCleanup(),
  }
}
