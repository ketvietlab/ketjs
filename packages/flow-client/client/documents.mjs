import { documentAccess } from './document-access.mjs'
import { auditChange } from './audit-display.mjs'
import { FlowInput, FlowLiveDoc, FlowLiveDocLegacyBlocks } from '@ketvietlab/flow-ui'
import { tr, flowLocaleTag } from './i18n.mjs'
import { html, each, signal } from '@ketvietlab/ketjs-view'
import {
  FlowShell,
  FlowButton,
  FlowSearch,
  FlowSelect,
  FlowSegmented,
  FlowAvatar,
  FlowEmpty,
} from '@ketvietlab/flow-ui'
import {
  FlowUserPicker,
  FlowActivity,
  FlowHint,
  FlowInline,
  FlowScopeMenu,
  FlowStack,
  FlowNotice,
  FlowSection,
  FlowToolbar,
} from '@ketvietlab/flow-ui/workspace'
import {
  FlowDocBlank,
  FlowDocsShell,
  FlowDocTree,
  FlowDocEditor,
  FlowDocOutline,
  FlowDocPanel,
} from '@ketvietlab/flow-ui/documents'

import { pagesInScope } from './navigation.mjs'
import { documentSiblings, filterDocumentTree } from './document-tree.mjs'

export const documentRoutes = new Set(['pages', 'all-pages', 'page', 'page-archived'])
export const documentBlocks = (page) =>
  structuredClone(page.blocks ?? [{ id: 'intro', type: 'paragraph', text: page.content ?? '' }])
const normalize = (text) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
// Per-page drafts belong to the product controller and survive navigation. Native
// text edits are collected without rerendering on every keystroke or losing selection.
export function createDocuments(ctx) {
  const search = signal(''),
    scope = signal('shared'),
    inspector = signal('outline'),
    inspectorHidden = signal(false),
    collapsed = signal([]),
    active = signal(''),
    revision = signal(0),
    dirty = signal(false),
    favorites = signal([])
  const drafts = new Map(),
    sharing = new Map()
  const canEdit = () => ctx.canWrite() && current()?.access?.write !== false
  const editAccess = (page) => {
    if (!sharing.has(page.id))
      sharing.set(page.id, {
        visibility: page.visibility ?? 'shared',
        readerIds: [...(page.readerIds ?? [])],
      })
    return sharing.get(page.id)
  }
  const command = (page, action) =>
    ctx.mutate('flow.entity.action', { collection: 'pages', entityId: page.id, action }, () =>
      ctx.navigate(action === 'archive' ? 'page-archived' : 'page', {
        id: page.id,
        project: page.projectId ?? '',
      }),
    )
  const owned = () =>
    pagesInScope(ctx.data().pages, ctx.project()).filter(
      (p) => p.projectId || !ctx.data().workspaces || p.workspaceId === ctx.workspaceId(),
    )
  const current = () => {
    if (ctx.screen() === 'all-pages') return null
    if (ctx.screen() === 'page') return owned().find((p) => p.id === ctx.record() && !p.archived)
    return owned().find(
      (p) => !p.archived && (scope() === 'private' ? p.visibility === 'private' : p.visibility !== 'private'),
    )
  }
  const draftFor = (page) => {
    if (!drafts.has(page.id))
      drafts.set(page.id, {
        title: page.title,
        blocks: documentBlocks(page),
        liveDoc: page.liveDoc,
        dirty: false,
      })
    return drafts.get(page.id)
  }
  const refresh = () => revision.set(revision() + 1)
  const changed = () => {
    const p = current()
    if (p) {
      draftFor(p).dirty = true
      dirty.set(true)
    }
  }
  const focus = (id) => active.set(id)
  const open = (id) => {
    scope.set(ctx.data().pages.find((p) => p.id === id)?.visibility === 'private' ? 'private' : 'shared')
    const page = ctx.data().pages.find((p) => p.id === id)
    if (!page) return
    ctx.navigate('page', {
      id,
      project: page.projectId ?? '',
      scope: page.projectId ? 'project' : 'workspace',
      ...(ctx.screen() === 'all-pages' ? { returnTo: ctx.libraryURL() } : {}),
    })
  }
  const save = async () => {
    const page = current(),
      draft = draftFor(page)
    const ok = await ctx.mutate('flow.entity.save', {
      collection: 'pages',
      entityId: page.id,
      expectedVersion: page.version,
      title: draft.title,
      description: draft.blocks
        .map((b) => b.text ?? b.rows?.map((row) => row.join(' | ')).join('\n') ?? '')
        .join('\n\n'),
      blocks: structuredClone(draft.blocks),
      liveDoc: draft.liveDoc,
      parentId: page.parentId,
      projectId: page.projectId,
    })
    if (ok) {
      draft.dirty = false
      dirty.set(false)
    }
  }
  const library = () => {
    const filter = ctx.libraryFilter()
    const workspaceProjects = ctx
      .data()
      .projects.filter((p) => !ctx.data().workspaces || p.workspaceId === ctx.workspaceId())
    const items = ctx
      .data()
      .pages.filter(
        (p) =>
          (!ctx.data().workspaces ||
            (p.projectId
              ? workspaceProjects.some((x) => x.id === p.projectId)
              : p.workspaceId === ctx.workspaceId())) &&
          !p.archived &&
          (ctx.libraryVisibility() === 'private' ? p.visibility === 'private' : p.visibility !== 'private'),
      )
    const owners = [
      { id: 'workspace', title: tr('flow.ui.workspace.documents.52c25b'), projectId: null },
      ...workspaceProjects.map((p) => ({ ...p, projectId: p.id })),
    ].filter((p) => filter === 'all' || p.id === filter)
    return FlowShell({
      navigation: ctx.managementViews(),
      contentWidth: 'wide',
      title: tr('flow.ui.document.library'),
      search: FlowSearch({
        label: tr('flow.ui.search.documents'),
        placeholder: tr('flow.ui.search.library'),
        value: ctx.librarySearch(),
        onInput: (e) => ctx.updateLibrary({ docq: e.target.value }),
      }),
      breadcrumb: ctx.data().company.name,
      sidebar: ctx.sidebar(),
      actions: FlowButton({
        label: tr('flow.ui.create.workspace.document'),
        icon: 'plus',
        size: 'sm',
        disabled: !ctx.canWrite(),
        onClick: () => ctx.navigate('page-new', { scope: 'workspace', returnTo: ctx.libraryURL() }),
      }),
      children: FlowStack({
        children: html`
      ${FlowToolbar({
        children: FlowSegmented({
          label: tr('flow.ui.visibility'),
          value: ctx.libraryVisibility(),
          options: [
            { value: 'shared', label: tr('flow.ui.shared') },
            { value: 'private', label: tr('flow.ui.private') },
          ],
          onChange: (v) => ctx.updateLibrary({ visibility: v }),
        }),
        trailing: FlowSelect({
          label: tr('flow.ui.document.ownership'),
          value: filter,
          options: [
            { value: 'all', label: tr('flow.ui.all.locations') },
            { value: 'workspace', label: tr('flow.ui.workspace') },
            ...workspaceProjects.map((p) => ({ value: p.id, label: p.title })),
          ],
          onChange: (e) =>
            ctx.navigate('all-pages', {
              projectFilter: e.target.value,
              docq: ctx.librarySearch(),
              visibility: ctx.libraryVisibility(),
            }),
        }),
      })}
      ${each(
        owners,
        (o) => o.id,
        (o) => {
          const pages = filterDocumentTree(pagesInScope(items, o.projectId), (p) =>
            normalize(p.title).includes(normalize(ctx.librarySearch())),
          )
          return FlowSection({
            title: o.title,
            actions: FlowButton({
              label: tr('flow.ui.open.document'),
              size: 'sm',
              onClick: () =>
                ctx.navigate('pages', {
                  project: o.projectId ?? '',
                  scope: o.projectId ? 'project' : 'workspace',
                  returnTo: ctx.libraryURL(),
                }),
            }),
            children: pages.length
              ? FlowDocTree({
                  items: pages,
                  active: '',
                  collapsed: collapsed(),
                  onOpen: open,
                  onToggle: (id) =>
                    collapsed.set(
                      collapsed().includes(id) ? collapsed().filter((x) => x !== id) : [...collapsed(), id],
                    ),
                })
              : FlowEmpty({
                  title: tr('flow.ui.no.documents.yet'),
                  description: ctx.librarySearch()
                    ? tr('flow.ui.no.documents.match.your.search')
                    : tr('flow.ui.documents.in.this.scope.will.appear.here'),
                }),
          })
        },
      )}`,
      }),
    })
  }
  const view = () => {
    revision()
    if (ctx.screen() === 'all-pages') return library()
    const page = current(),
      draft = page ? draftFor(page) : null
    dirty()
    const isArchive = ctx.screen() === 'page-archived'
    const visibility = ctx.screen() === 'page' && page ? (page.visibility ?? 'shared') : scope()
    const eligible = owned().filter((p) =>
      isArchive
        ? p.archived
        : !p.archived && (visibility === 'private' ? p.visibility === 'private' : p.visibility !== 'private'),
    )
    const visible = filterDocumentTree(eligible, (p) => normalize(p.title).includes(normalize(search())))
    const selected = draft?.blocks.find((b) => b.id === active())
    const headers =
      draft?.blocks
        .filter((b) => ['heading', 'subheading'].includes(b.type))
        .map((b) => ({ id: b.id, text: b.text, level: b.type === 'heading' ? 2 : 3 })) ?? []
    const button = (label, fn, icon, variant = 'ghost') =>
      FlowButton({ label, onClick: fn, icon, variant, size: 'sm' })
    const project = ctx.data().projects.find((p) => p.id === ctx.project())
    const documentSearch = FlowSearch({
      label: tr('flow.ui.search.documents'),
      value: search(),
      placeholder: tr('flow.ui.search.documents.711e40'),
      onInput: (e) => search.set(e.target.value),
    })
    const documentActions = project
      ? ctx.projectActions()
      : FlowInline({
          children: html`${button(tr('flow.ui.document.library'), () => ctx.navigate('all-pages'), 'book')}${FlowAvatar({ name: ctx.data().user.name })}`,
        })
    const tree = html`${FlowSegmented({
      label: tr('flow.ui.document.scope'),
      appearance: 'underline',
      value: isArchive ? 'archived' : visibility,
      options: [
        { value: 'shared', label: tr('flow.ui.shared') },
        { value: 'private', label: tr('flow.ui.private') },
        { value: 'archived', label: tr('flow.ui.archive') },
      ],
      onChange: (value) => {
        if (value === 'archived') ctx.navigate('page-archived')
        else {
          scope.set(value)
          const target = owned().find(
            (p) =>
              !p.archived && (value === 'private' ? p.visibility === 'private' : p.visibility !== 'private'),
          )
          if (target) open(target.id)
          else ctx.navigate('pages', { scope: ctx.project() ? 'project' : 'workspace' })
        }
      },
    })}${!visible.length ? FlowEmpty({ title: tr('flow.ui.no.documents.yet'), description: search() ? tr('flow.ui.try.another.search.term') : tr('flow.ui.your.team.s.documents.will.appear.here') }) : null}${FlowDocTree(
      {
        onCreate: ctx.canWrite() && !isArchive ? () => ctx.navigate('page-new') : undefined,
        onAddChild:
          ctx.canWrite() && !isArchive
            ? (id) =>
                ctx.data().pages.find((p) => p.id === id)?.access?.write !== false &&
                ctx.navigate('page-child', { id })
            : undefined,
        items: visible,
        active: page?.id ?? '',
        collapsed: collapsed(),
        onOpen: open,
        onToggle: (id) =>
          collapsed.set(
            collapsed().includes(id) ? collapsed().filter((x) => x !== id) : [...collapsed(), id],
          ),
        onReorder:
          ctx.canWrite() && !isArchive && !search()
            ? (id, targetId, position) => {
                const source = ctx.data().pages.find((p) => p.id === id)
                if (!source || source.access?.write === false) return
                void ctx.mutate('flow.page.reorder', {
                  id,
                  targetId,
                  position,
                  expectedSiblingIds: documentSiblings(ctx.data().pages, source).map((p) => p.id),
                })
              }
            : undefined,
      },
    )}`
    const toolbar = null
    const editor =
      page && !isArchive
        ? FlowDocEditor({
            title: draft.title,
            subtitle: html`${FlowAvatar({ name: ctx.data().user.name })}<span
                >${ctx.data().user.name} ·
                ${draft.dirty ? tr('flow.ui.unsaved.changes') : tr('flow.ui.saved.in.this.session')}</span
              >${FlowButton({ label: ctx.busy() ? tr('flow.ui.saving') : tr('flow.ui.save.document'), size: 'sm', disabled: !canEdit() || ctx.busy(), onClick: save })}${FlowScopeMenu(
                {
                  label: tr('flow.ui.document.options'),
                  items: [
                    ...(canEdit()
                      ? [
                          {
                            label: tr('flow.review.rename'),
                            onClick: () => {
                              inspector.set('rename')
                              inspectorHidden.set(false)
                            },
                          },
                          { label: tr('flow.review.archive'), onClick: () => command(page, 'archive') },
                        ]
                      : []),
                    {
                      label: tr('flow.review.docHistory'),
                      onClick: () => {
                        inspector.set('history')
                        inspectorHidden.set(false)
                      },
                    },
                    {
                      label: inspectorHidden()
                        ? tr('flow.ui.show.right.panel')
                        : tr('flow.ui.hide.right.panel'),
                      onClick: () => inspectorHidden.set(!inspectorHidden()),
                    },
                    {
                      label: favorites().includes(page.id)
                        ? tr('flow.ui.remove.from.favorites')
                        : tr('flow.ui.favorite'),
                      onClick: () =>
                        favorites.set(
                          favorites().includes(page.id)
                            ? favorites().filter((x) => x !== page.id)
                            : [...favorites(), page.id],
                        ),
                    },
                  ],
                },
              )}`,
            blocks: draft.blocks,
            children: FlowLiveDoc({
              id: `${ctx.data().company.id}-page-${page.id}`,
              label: tr('flow.ui.content'),
              snapshot: draft.liveDoc,
              blocks: draft.blocks,
              readOnly: !canEdit(),
              onChange: (value) => {
                draft.liveDoc = value.snapshot
                draft.blocks = FlowLiveDocLegacyBlocks(value)
                draft.dirty = true
                dirty.set(true)
              },
              onBlur: refresh,
            }),
            readOnly: !canEdit(),
            onTitle: (text) => {
              draft.title = text
              draft.dirty = true
            },
            onText: (id, text, row, col) => {
              const b = draft.blocks.find((b) => b.id === id)
              if (row != null) b.rows[row][col] = text
              else b.text = text
              draft.dirty = true
            },
            onFocus: focus,
            onBlur: () => {
              dirty.set(draft.dirty)
              refresh()
            },
            onCheck: (id, checked) => {
              draft.blocks.find((b) => b.id === id).checked = checked
              changed()
              refresh()
            },
          })
        : FlowDocBlank({
            title: isArchive ? tr('flow.ui.archived.document') : tr('flow.ui.document.library'),
            children: html`<div>
              ${FlowEmpty({ title: isArchive ? tr('flow.ui.archived.document') : ctx.screen() === 'page' ? tr('flow.ui.document.not.found') : tr('flow.ui.no.documents.yet'), description: isArchive ? tr('flow.ui.restore.this.document.to.continue.editing') : tr('flow.ui.select.a.document.in.the.tree.or.create.one.here'), action: button(tr('flow.ui.create.document'), () => ctx.navigate('page-new'), 'plus', 'primary') })}${
                isArchive
                  ? html`${each(
                      visible,
                      (p) => p.id,
                      (p) =>
                        FlowNotice({
                          title: p.title,
                          message: tr('flow.ui.archived.by', [
                            p.archivedBy ?? 'Flow',
                            p.archivedAt
                              ? new Date(p.archivedAt).toLocaleDateString(flowLocaleTag())
                              : tr('flow.ui.sample.data'),
                            p.projectId
                              ? ctx.data().projects.find((x) => x.id === p.projectId)?.title
                              : (ctx.data().workspaces?.find((x) => x.id === p.workspaceId)?.title ??
                                'Workspace'),
                            p.parentId
                              ? ctx.data().pages.some((x) => x.id === p.parentId && !x.archived)
                                ? tr('flow.ui.restore.under.original.parent')
                                : tr('flow.ui.parent.archived.restore.to.root')
                              : tr('flow.ui.root.page'),
                          ]),
                          action: FlowButton({
                            label: tr('flow.ui.restore'),
                            disabled: !ctx.canWrite() || p.access?.write === false,
                            onClick: () =>
                              ctx.mutate('flow.entity.action', {
                                collection: 'pages',
                                entityId: p.id,
                                action: 'restore',
                              }),
                          }),
                        }),
                    )}`
                  : null
              }
            </div>`,
          })
    const inspectorContent = html`${FlowSegmented({
      label: tr('flow.ui.page.details'),
      value: inspector(),
      options: [
        { value: 'outline', label: tr('flow.ui.outline') },
        { value: 'info', label: tr('flow.ui.information') },
        { value: 'assets', label: tr('flow.ui.links') },
      ],
      onChange: (value) => inspector.set(value),
    })}${
      inspector() === 'rename' && page
        ? FlowDocPanel({
            title: tr('flow.review.rename'),
            children: FlowStack({
              children: html`${FlowInput({
                id: 'document-title',
                label: tr('flow.ui.title'),
                value: draft.title,
                onInput: (e) => {
                  draft.title = e.target.value
                  draft.dirty = true
                },
              })}${FlowButton({ label: tr('flow.ui.save'), disabled: !canEdit(), onClick: save })}`,
            }),
          })
        : inspector() === 'history' && page
          ? FlowDocPanel({
              title: tr('flow.review.docHistory'),
              children: FlowActivity({
                items: [...(page.history ?? [])].reverse().map((e) => ({
                  ...e,
                  text:
                    tr('flow.review.version', [e.version]) +
                    ' · ' +
                    e.changes.map((c) => auditChange(c, ctx.data())).join('; '),
                  time: new Date(e.time).toLocaleString(flowLocaleTag()),
                })),
              }),
            })
          : inspector() === 'outline'
            ? FlowDocOutline({
                items: headers,
                active: active(),
                onOpen: (id) => {
                  active.set(id)
                  ctx
                    .root()
                    ?.querySelector(`[id="doc-${CSS.escape(id)}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                },
              })
            : inspector() === 'info'
              ? FlowDocPanel({
                  title: tr('flow.ui.document.information'),
                  children: html`<p>${tr('flow.ui.workspace.fec2ab', [ctx.data().company.name])}</p>
                <p>${tr('flow.ui.owned.by', [project?.title ?? tr('flow.ui.workspace')])}</p>
                <p>${tr('flow.ui.assignee', [ctx.data().members.find((m) => m.id === page?.ownerId)?.name ?? '—'])}</p>
                <p>${tr('flow.ui.access', [ctx.canWrite() ? tr('flow.ui.can.edit') : tr('flow.ui.view.only')])}</p>
                <p>${tr('flow.ui.content.blocks', [draft?.blocks.length ?? 0])}</p>
                ${
                  page
                    ? FlowSection({
                        inset: 'none',
                        title: tr('flow.review.whoReads'),
                        children: page.access?.manage
                          ? FlowStack({
                              children: html`${FlowSelect({
                                label: tr('flow.review.whoReads'),
                                value: editAccess(page).visibility,
                                options: [
                                  { value: 'shared', label: tr('flow.review.inherited') },
                                  { value: 'private', label: tr('flow.review.private') },
                                ],
                                onChange: (e) => {
                                  editAccess(page).visibility = e.target.value
                                  refresh()
                                },
                              })}${FlowUserPicker({
                                id: 'document-readers',
                                label: tr('flow.review.readers'),
                                size: 'sm',
                                value: editAccess(page).readerIds,
                                options: ctx
                                  .data()
                                  .members.filter(
                                    (m) =>
                                      m.status === 'active' &&
                                      m.id !== page.ownerId &&
                                      documentAccess(
                                        ctx.data(),
                                        { ...page, visibility: 'shared', readerIds: [m.id] },
                                        m.id,
                                      ).read,
                                  )
                                  .map((m) => ({ id: m.id, name: m.name })),
                                onChange: (ids) => {
                                  editAccess(page).readerIds = ids
                                  refresh()
                                },
                              })}${FlowHint({ children: tr('flow.review.shareHelp') })}${FlowButton({ label: tr('flow.review.saveSharing'), disabled: !canEdit(), onClick: () => ctx.mutate('flow.document.command', { id: page.id, ...editAccess(page), expectedVersion: page.version }, () => open(page.id)) })}`,
                            })
                          : html`<p>${tr(page.visibility === 'private' ? 'flow.review.private' : 'flow.review.inherited')}</p>`,
                      })
                    : null
                }
                ${page && canEdit() ? button(tr('flow.ui.move.document'), () => ctx.navigate('page-move', { id: page.id }), 'folder') : null}`,
                })
              : FlowDocPanel({
                  title: tr('flow.ui.project.tasks'),
                  children: html`<p>${tr('flow.ui.keep.documents.alongside.tasks.so.your.team.has.the.context')}</p>
                ${
                  project
                    ? html`${each(
                        ctx
                          .data()
                          .tasks.filter((t) => t.projectId === project.id)
                          .slice(0, 3),
                        (t) => t.id,
                        (t) =>
                          button(
                            `${t.id} · ${t.title}`,
                            () => ctx.navigate('issue', { id: t.id, project: project.id }),
                            'link',
                          ),
                      )}`
                    : html`<p>${tr('flow.ui.this.document.belongs.to.the.workspace.not.a.project')}</p>`
                }`,
                })
    }`
    return FlowDocsShell({
      sidebar: ctx.sidebar(),
      title: project?.title ?? ctx.data().company.name,
      search: documentSearch,
      actions: documentActions,
      navigation: project ? ctx.projectViews() : null,
      tree,
      toolbar,
      inspector: inspectorContent,
      hideInspector: inspectorHidden(),
      children: editor,
      notice: ctx.notices(),
    })
  }
  return { view }
}
