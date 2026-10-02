import { cancelSchedule, publishEntry, scheduledAt, scheduleTime } from './entry-publishing.mjs'
import { builderDialog } from './builder-dialogs.mjs'
import { builderToolbar } from './builder-toolbar.mjs'
import { createBuilderDrag } from '../builder-drag.mjs'
import { locatePlacement, movePlacementAt, planPlacementMove, placementSlots } from '../builder-placement.mjs'
import { createBuilderWorkspace } from './builder-workspace.mjs'
import { createBuilderTools, builderPanel, builderQuery } from './builder-tools.mjs'
import { checkBuilderAccessibility } from '../builder-checks.mjs'
// Page builder: structure · canvas · inspector over the stored layout (`Placement[]`). The draft
// lives in this island until saved; saving sends the revision it was based on, so a concurrent
// edit is a conflict, never a silent overwrite. The canvas uses the public theme renderer.
import { html, signal } from '@ketvietlab/ketjs-view'
import {
  ActionGroup,
  IconButton,
  EmptyState,
  LinkButton,
  Notice,
  Menu,
  Section,
  Select,
  Stack,
  Status,
  Surface,
  TabbedView,
  TextArea,
  TextField,
  Tree,
  WorkspacePage,
} from '@ketvietlab/design-system'
import { h, CommandButton, icon } from '../ui.mjs'
import { renderLayout, walkLayout, safeImage } from '../renderer.mjs'
import { newId } from './format.mjs'

const HISTORY_LIMIT = 50

/** Locate a placement and the array that holds it, at any depth. */
export const locate = locatePlacement

const clone = (value) => structuredClone(value)

export function createBuilder(ctx) {
  const tr = ctx.tr
  /** entryId → { entry, layout, base, dirty, past, future, lastEdit } — one draft per page, kept across navigation. */
  const drafts = new Map()
  const version = signal(0)
  const touch = () => version.set((n) => n + 1)
  const guard = (event) => {
    if ([...drafts.values()].some((d) => d.dirty)) event.preventDefault()
  }
  let guarding = false
  let templates = []
  let previewWidth = 'desktop'
  let zoom = 100
  let dialogOpener = null
  let lastDialog = null
  const closeDialog = async () => {
    globalThis.document?.getElementById('website-builder-dialog')?.close()
    lastDialog = null
    await ctx.navigate(
      'builder',
      { id: current().id },
      { ...builderQuery(ctx.route().query), dialog: undefined },
    )
    if (dialogOpener?.isConnected) dialogOpener.focus()
  }
  let focusedField = null
  let catalogue = {}
  // The site's forms for the form block: the list feeds its picker, the open ones its canvas preview.
  let forms = []
  let formPreviews = {}

  const current = () => {
    const route = ctx.route()
    return {
      id: route.params.id,
      node: route.query.node ?? drafts.get(route.params.id)?.layout[0]?.id ?? null,
    }
  }
  const draftOf = (id) => drafts.get(id)
  // A closed or unreadable form previews as missing, exactly as visitors would not see it.
  const quietly = (signal, promise) =>
    promise.catch((error) => {
      if (signal?.aborted) throw error
      return null
    })
  const readForms = async (signal) => {
    const siteId = ctx.site().id
    forms = (await quietly(signal, ctx.call('website_form.listForms', { siteId }, { signal })))?.rows ?? []
    const previews = await Promise.all(
      forms
        .filter((form) => form.active)
        .map((form) =>
          quietly(signal, ctx.call('website_studio.visitorForm', { siteId, id: form.id }, { signal })),
        ),
    )
    formPreviews = Object.fromEntries(
      previews
        .filter(Boolean)
        .map(({ form, fields }) => [
          form.id,
          { id: form.id, title: form.title, fields, consentText: form.consentLabel || null },
        ]),
    )
  }
  /** What `website_form.publicForm` would answer for each form placement, from the forms read above. */
  const formSectionData = (layout) => {
    const data = {}
    walkLayout(layout, (placement) => {
      const form = placement.type === 'website_form.form' && formPreviews[placement.settings?.formId]
      if (form)
        data[placement.id] = {
          ...form,
          heading: placement.settings.heading || null,
          description: placement.settings.description || null,
        }
    })
    return data
  }
  const change = (id, mutate, coalesce = null) => {
    const draft = draftOf(id)
    if (!draft) return
    drag.cancel(false)
    if (!coalesce || draft.lastEdit !== coalesce) {
      draft.past.push(clone(draft.layout))
      if (draft.past.length > HISTORY_LIMIT) draft.past.shift()
      draft.future = []
    }
    draft.lastEdit = coalesce
    mutate(draft.layout)
    draft.dirty = true
    if (!guarding && globalThis.addEventListener) {
      addEventListener('beforeunload', guard)
      guarding = true
    }
    touch()
  }

  const tools = createBuilderTools(ctx, {
    draft: () => draftOf(current().id),
    change: (fn) => change(current().id, fn),
    save,
    touch,
  })

  const workspace = createBuilderWorkspace(ctx, {
    draft: () => draftOf(current().id),
    templates: () => templates,
    change: (fn) => change(current().id, fn),
    save,
    touch,
  })
  const nodeLabel = (placement) =>
    String(
      placement?.settings?.heading || catalogue[placement?.type]?.title || tr('website.drag.block'),
    ).slice(0, 100)
  const drag = createBuilderDrag({
    getState: () =>
      ctx.route().key === 'builder'
        ? {
            key: current().id,
            layout: draftOf(current().id)?.layout ?? [],
            editable: ctx.can('website.content.write') && !ctx.busy(),
          }
        : null,
    commit: (id, target) => {
      const plan = planPlacementMove(draftOf(current().id)?.layout ?? [], id, target)
      if (!plan || plan.noop || !ctx.can('website.content.write') || ctx.busy()) return
      change(current().id, (layout) => movePlacementAt(layout, id, target))
    },
    label: nodeLabel,
    tr,
    onError: (error) => ctx.notify(error.message),
  })
  const dragHandle = (placement) =>
    ctx.can('website.content.write')
      ? html`<span class="website-builder-drag-handle" data-builder-drag-id=${placement.id}>${h(IconButton, { icon: icon('grip-vertical'), label: tr('website.drag.handle', { name: nodeLabel(placement) }), variant: 'secondary', describedBy: 'website-builder-drag-instructions', disabled: ctx.busy(), name: 'builder-drag', value: placement.id })}</span>`
      : null
  const emptyDropSlot = (destination) =>
    html`<div class="website-builder-empty-slot">${tr(destination.endsWith(':left') ? 'website.drag.emptyLeft' : destination.endsWith(':right') ? 'website.drag.emptyRight' : 'website.drag.emptyRoot')}</div>`
  let keyboardAttached = false
  let screen
  const keyboard = (event) => {
    if (ctx.route().key !== 'builder' || drag.active()) return
    const typing = event.target?.closest?.('input,textarea,select,[contenteditable="true"]')
    let action = null,
      args = {}
    const key = event.key.toLowerCase(),
      modifier = event.metaKey || event.ctrlKey
    if (modifier && key === 'k') {
      event.preventDefault()
      ctx.navigate(
        'builder',
        { id: current().id },
        { ...builderQuery(ctx.route().query), dialog: 'commands' },
      )
      return
    }
    if (typing || !ctx.can('website.content.write')) return
    if (modifier && key === 'z') action = event.shiftKey ? 'redo' : 'undo'
    if (modifier && key === 's') action = 'save'
    if (current().node) {
      args = { id: current().node }
      if (modifier && key === 'd') action = 'duplicate'
      if (key === 'delete') action = 'remove'
      if (event.altKey && ['arrowup', 'arrowdown'].includes(key)) {
        action = 'move'
        args.by = key === 'arrowup' ? '-1' : '1'
      }
    }
    if (action) {
      event.preventDefault()
      Promise.resolve(screen.commands[`builder.${action}`](args)).catch((error) => ctx.notify(error.message))
    }
  }
  const selectOnCanvas = (event) => {
    if (event.defaultPrevented || event.target.closest?.('[data-builder-drag-id]')) return
    const node = event.target.closest?.('[data-node]')
    if (!node) return
    event.preventDefault()
    ctx.navigate(
      'builder',
      { id: current().id },
      { ...builderQuery(ctx.route().query), node: node.dataset.node },
      { replace: true },
    )
  }

  const treeNodes = (layout, sections, selected) =>
    layout.map((placement) => ({
      id: placement.id,
      label: html`<span class="website-builder-tree-label" data-builder-drop-node=${placement.id}>${ctx.can('website.content.write') ? html`<span class="website-builder-tree-grip" data-builder-drag-id=${placement.id} aria-hidden="true">${icon('grip-vertical')}</span>` : null}<span>${nodeLabel(placement)}</span></span>`,
      href: ctx.href('builder', { id: current().id }, { node: placement.id }),
      active: placement.id === selected,
      expanded: true,
      children: placement.slots
        ? Object.entries(placement.slots).map(([slot, children]) => ({
            id: `${placement.id}:${slot}`,
            label: html`<span class="website-builder-tree-slot" data-builder-drop-slot=${`${placement.id}:${slot}`}>${tr(slot === 'left' ? 'website.builder.slotLeft' : slot === 'right' ? 'website.builder.slotRight' : 'website.drag.slot')}${children.length ? '' : ` · ${tr('website.drag.empty')}`}</span>`,
            href: ctx.href('builder', { id: current().id }, { node: `${placement.id}:${slot}` }),
            expanded: true,
            children: treeNodes(children, sections, selected),
          }))
        : [],
    }))

  const field = (name, kind, value, disabled) => {
    const label = tr(`website.builder.setting.${name}`)
    const common = { id: `builder-${name}`, name, label, value: value ?? '', disabled }
    if (name === 'visibility')
      return h(Select, {
        ...common,
        value: value || 'all',
        options: ['all', 'desktop', 'mobile'].map((value) => ({
          value,
          label: tr(`website.builder.visibility.${value}`),
        })),
      })
    if (name === 'formId')
      return h(Select, {
        ...common,
        options: [
          { value: '', label: tr('website.builder.form.choose') },
          ...forms.map((form) => ({ value: form.id, label: form.title })),
        ],
      })
    if (name === 'align')
      return h(Select, {
        ...common,
        value: value ?? 'start',
        options: [
          { value: 'start', label: tr('website.builder.align.start') },
          { value: 'center', label: tr('website.builder.align.center') },
        ],
      })
    if (kind.startsWith('ref:'))
      return h(LinkButton, {
        label: tr('website.workspace.changeImage'),
        href: ctx.href(
          'builder',
          { id: current().id },
          { ...builderQuery(ctx.route().query), dialog: 'media', node: current().node },
        ),
      })
    if (name === 'body') return h(TextArea, common)
    return h(TextField, { ...common, required: !kind.endsWith('?') })
  }

  const inspector = (sections, placement, canWrite) => {
    if (!placement)
      return h(EmptyState, {
        title: tr('website.builder.nothingSelected'),
        message: tr('website.builder.selectHint'),
      })
    const settings = sections[placement.type]?.settings ?? {}
    const args = { id: placement.id }
    const tab = ctx.route().query.inspector ?? 'content'
    const visibleFields = Object.entries(settings)
      .filter(
        ([name]) =>
          ![
            'responsive',
            'profile',
            'locale',
            'layoutMode',
            'focalX',
            'focalY',
            'imageFit',
            'imageRatio',
          ].includes(name),
      )
      .filter(([name]) =>
        tab === 'advanced'
          ? name === 'visibility'
          : tab === 'design'
            ? name === 'align'
            : !['align', 'visibility'].includes(name),
      )
    return h(Stack, {
      divided: true,
      items: [
        html`<nav class="website-inspector-tabs" aria-label=${tr('website.workspace.inspectorTabs')}>${['content', 'design', 'advanced'].map((key) => h(LinkButton, { label: tr(`website.workspace.${key}`), href: ctx.href('builder', { id: current().id }, { ...builderQuery(ctx.route().query), node: placement.id, inspector: key, dialog: undefined }) })).reduce((a, b) => html`${a}${b}`, html``)}</nav>`,
        placement.settings?.image
          ? html`<figure class="website-media-preview"><img src=${safeImage(placement.settings.image)} alt=${placement.settings.alt ?? ''} />${h(LinkButton, { label: tr('website.workspace.changeImage'), href: ctx.href('builder', { id: current().id }, { ...builderQuery(ctx.route().query), dialog: 'media', node: placement.id }) })}</figure>`
          : null,
        html`<form id="builder-destination">${h(Select, {
          id: 'builder-destination-select',
          name: 'destination',
          label: tr('website.builder.destination'),
          options: [
            { value: '', label: tr('website.builder.root') },
            ...slotOptions(draftOf(current().id).layout, placement.id).map((value) => ({
              value,
              label: tr('website.builder.slotDestination', {
                section:
                  sections[
                    locate(draftOf(current().id).layout, value.slice(0, value.lastIndexOf(':')))?.placement
                      .type
                  ]?.title ?? tr('website.builder.structure'),
                slot: value.endsWith(':left') ? tr('website.builder.left') : tr('website.builder.right'),
              }),
            })),
          ],
          disabled: !canWrite,
        })}${CommandButton({ label: tr('website.builder.moveTo'), command: 'builder.moveTo', args: { id: placement.id }, type: 'submit', form: 'builder-destination', disabled: !canWrite })}</form>`,
        html`<form data-live="builder.edit" novalidate>
          <input type="hidden" name="__node" value=${placement.id} />
          ${h(Stack, {
            items: visibleFields.map(([name, kind]) =>
              field(name, kind, placement.settings?.[name], !canWrite),
            ),
          })}
        </form>`,
        tab === 'design'
          ? workspace.view(Object.keys(placement.slots ?? {}).length ? 'layout' : 'responsive', sections, {
              embedded: true,
            })
          : null,
        tab === 'advanced' ? workspace.view('visibility', sections, { embedded: true }) : null,
        h(Section, {
          title: tr('website.builder.arrange'),
          body: h(ActionGroup, {
            label: tr('website.builder.arrange'),
            actions: [
              CommandButton({
                label: tr('website.builder.moveUp'),
                command: 'builder.move',
                args: { ...args, by: '-1' },
                disabled: !canWrite,
              }),
              CommandButton({
                label: tr('website.builder.moveDown'),
                command: 'builder.move',
                args: { ...args, by: '1' },
                disabled: !canWrite,
              }),
              CommandButton({
                label: tr('website.builder.duplicate'),
                command: 'builder.duplicate',
                args,
                disabled: !canWrite,
              }),
              CommandButton({
                label: tr('website.builder.remove'),
                command: 'builder.remove',
                args,
                variant: 'destructive',
                disabled: !canWrite,
              }),
            ],
          }),
        }),
      ],
    })
  }

  screen = {
    readKey: (route) => route.params.id,
    read: async (route, signal) => {
      drag.cancel(false)
      drag.attach(globalThis.document)
      const value = await ctx.call('website.getEntry', { id: route.params.id }, { signal })
      if (value.entry.type === 'post') {
        await ctx.navigate('post-edit', { id: value.entry.id })
        return value
      }
      catalogue = value.sections
      if (ctx.can('website.content.write'))
        templates = (
          await ctx.call(
            'website_studio.listResources',
            { siteId: ctx.site().id, kind: 'templates', search: '' },
            { signal },
          )
        ).rows
      if (catalogue['website_form.form']) await readForms(signal)
      const known = drafts.get(value.entry.id)
      if (known) {
        known.entry = value.entry
        if (!known.dirty && known.base !== value.entry.revisionId) {
          known.layout = clone(value.entry.layout)
          known.base = value.entry.revisionId
          known.past = []
          known.future = []
        }
      } else
        drafts.set(value.entry.id, {
          entry: value.entry,
          layout: clone(value.entry.layout),
          base: value.entry.revisionId,
          dirty: false,
          past: [],
          future: [],
          lastEdit: null,
        })
      await workspace.read()
      if (!keyboardAttached && globalThis.addEventListener) {
        addEventListener('keydown', keyboard)
        keyboardAttached = true
      }
      return value
    },
    view: (value) => {
      version()
      const { entry, sections } = value
      // Route changes render before its asynchronous read completes; never inspect the previous entry.
      if (entry.type === 'post' || entry.id !== ctx.route().params.id)
        return h(WorkspacePage, { title: tr('website.loading'), layout: 'canvas' })
      const draft = draftOf(entry.id)
      const { node } = current()
      const selected = node ? locate(draft.layout, node)?.placement : null
      const canWrite = ctx.can('website.content.write')
      const panel = builderPanel(ctx.route().query.panel)
      const templatePreview =
        panel === 'library' && ctx.route().query.section === 'templates' ? workspace.previewTemplate() : null
      const busy = ctx.busy()
      const dialog = ctx.route().query.dialog
      if (['commands', 'checks', 'schedule', 'media'].includes(dialog) && globalThis.document)
        queueMicrotask(() => {
          const element = document.getElementById('website-builder-dialog')
          if (!element || element.open) return
          if (!lastDialog) dialogOpener = document.activeElement
          lastDialog = dialog
          element.showModal()
          element.querySelector(dialog === 'commands' ? 'input' : '[data-ui="modal-close"]')?.focus()
        })
      else lastDialog = null
      const focus = ctx.route().query.field
      if (focus && focus !== focusedField && globalThis.document) {
        focusedField = focus
        queueMicrotask(() => document.getElementById(`builder-${focus}`)?.focus())
      }
      return h(WorkspacePage, {
        title: entry.title,
        meta: html`${h(LinkButton, {
          label: tr(entry.type === 'post' ? 'website.route.posts' : 'website.route.pages'),
          leading: icon('chevron-left'),
          variant: 'tertiary',
          href: ctx.href(entry.type === 'post' ? 'posts' : 'pages'),
        })}${h(Menu, { id: 'builder-pages', label: tr('website.builder.switchPage'), trigger: html`<span class="website-builder-page-icon" aria-hidden="true">${icon('file-text')}</span><span class="website-builder-page-trigger">${tr('website.builder.switchPage')}</span><span class="website-builder-page-chevron" aria-hidden="true">${icon('chevron-down')}</span>`, size: 'compact', items: workspace.pages().map((page) => ({ id: page.id, label: page.title, href: ctx.href('builder', { id: page.id }), leading: page.id === entry.id ? icon('check') : undefined })) })}`,
        status: html`<span class="website-builder-state">${h(Status, {
          label: tr(draft.dirty ? 'website.builder.unsaved' : 'website.builder.draftSaved'),
          tone: draft.dirty ? 'warning' : 'neutral',
        })}${
          workspace.live()
            ? h(Status, {
                label: tr(
                  draft.dirty || workspace.live() !== draft.base
                    ? 'website.builder.liveOlder'
                    : 'website.builder.liveCurrent',
                ),
                tone: 'positive',
              })
            : // Scheduled says more than "not published" about the same page.
              entry.publishAt
              ? null
              : h(Status, { label: tr('website.builder.notPublished'), tone: 'neutral' })
        }${
          entry.publishAt
            ? h(Status, {
                label: `${tr('website.entry.state.scheduled')} · ${scheduledAt(ctx, entry.publishAt)}`,
                tone: 'info',
              })
            : null
        }</span>`,
        layout: 'canvas',
        actions: builderToolbar(ctx, {
          entry,
          draft,
          previewWidth,
          zoom,
          busy,
          canWrite,
        }),
        body: html`<div class="website-builder-workspace" data-builder-drag-root="">${tools.navigation()}${canWrite ? html`<p class="website-builder-drag-sr" id="website-builder-drag-instructions">${tr('website.drag.instructions')}</p>` : null}<span class="website-builder-drag-sr" role="status" aria-live="polite" aria-atomic="true" data-builder-drag-status=""></span><div class="website-builder" data-panel=${panel} data-template-preview=${templatePreview ? 'true' : null}>
          ${
            panel !== 'structure' || ctx.route().query.section === 'shared'
              ? panel === 'library'
                ? html`<div class="website-builder-panel">${h(Surface, {
                    title: tr('website.tools.library'),
                    body: h(TabbedView, {
                      id: 'builder-library',
                      label: tr('website.tools.library'),
                      items: ['blocks', 'templates'].map((section) => ({
                        id: section,
                        label: tr(
                          section === 'blocks' ? 'website.builder.blocks' : 'website.workspace.templates',
                        ),
                        href: ctx.href('builder', { id: entry.id }, { panel: 'library', section, node }),
                        active: (ctx.route().query.section === 'templates') === (section === 'templates'),
                      })),
                      body: workspace.view(
                        ctx.route().query.section === 'templates' ? 'templates' : 'library',
                        sections,
                        { embedded: true },
                      ),
                    }),
                  })}</div>`
                : workspace.view(panel === 'structure' ? 'shared' : panel, sections)
              : html`<div class="website-builder-panel">${h(Surface, {
                  title: tr('website.builder.structure'),
                  body: h(Stack, {
                    items: [
                      h(Section, {
                        title: tr('website.workspace.header'),
                        body: h(LinkButton, {
                          label: tr('website.workspace.shared'),
                          href: ctx.href(
                            'builder',
                            { id: entry.id },
                            { panel: 'structure', section: 'shared' },
                          ),
                        }),
                      }),
                      draft.layout.length
                        ? html`<div class="website-builder-tree-scroll" data-builder-surface="tree" data-builder-drop-slot="">${h(Tree, { label: tr('website.builder.structure'), nodes: treeNodes(draft.layout, sections, node) })}</div>`
                        : h(EmptyState, {
                            title: tr('website.builder.emptyTitle'),
                            message: tr('website.builder.emptyMessage'),
                          }),
                      h(Section, {
                        title: tr('website.workspace.footer'),
                        body: h(LinkButton, {
                          label: tr('website.workspace.shared'),
                          href: ctx.href(
                            'builder',
                            { id: entry.id },
                            { panel: 'structure', section: 'shared' },
                          ),
                        }),
                      }),
                      h(LinkButton, {
                        label: tr('website.workspace.addSection'),
                        href: ctx.href('builder', { id: entry.id }, { panel: 'library', node }),
                      }),
                      html`<small>${tr('website.workspace.moveHint')}</small>`,
                    ],
                  }),
                })}</div>`
          }
          ${h(Surface, {
            body: html`${templatePreview ? h(Notice, { title: tr('website.builder.templatePreview', { name: templatePreview.title }), message: tr('website.builder.templatePreviewHelp'), tone: 'info' }) : null}<div class="website-builder__canvas" data-builder-surface="canvas" data-viewport=${previewWidth} style=${`zoom:${zoom / 100}`} on:click=${templatePreview ? null : selectOnCanvas}>
              ${workspace.frame(
                renderLayout(
                  templatePreview?.layout ?? draft.layout,
                  templatePreview
                    ? { headingLevel: 2, viewport: previewWidth, locale: entry.locale }
                    : {
                        mode: 'builder',
                        controls: dragHandle,
                        emptySlot: ctx.can('website.content.write') ? emptyDropSlot : null,
                        headingLevel: 2,
                        viewport: previewWidth,
                        locale: entry.locale,
                        selected: node,
                        unknownLabel: (type) => tr('website.builder.unknownSection', { type }),
                        sectionData: formSectionData(draft.layout),
                        formText: {
                          send: tr('website.formJourney.send'),
                          missing: tr('website.builder.form.missing'),
                        },
                      },
                ),
              )}
            </div>`,
          })}
          ${
            templatePreview
              ? null
              : html`<div class="website-builder-panel">${h(Surface, {
                  title: selected
                    ? (sections[selected.type]?.title ?? selected.type)
                    : tr('website.builder.inspector'),
                  body: html`${
                    !canWrite
                      ? h(Notice, {
                          title: tr('website.readonly.title'),
                          message: tr('website.readonly.message'),
                          tone: 'warning',
                        })
                      : null
                  }${inspector(sections, selected, canWrite)}`,
                })}</div>`
          }
        </div></div><footer class="website-builder-status">${tr('website.workspace.next')} · ${tr('website.workspace.quick')}</footer>${builderDialog(ctx, { draft, sections, workspace, close: closeDialog })}`,
      })
    },
    commands: {
      ...workspace.commands,
      'builder.template': ({ id }) => workspace.template(id),
      'builder.duplicate': ({ id: nodeId }) => {
        change(current().id, (layout) => {
          const found = locate(layout, nodeId)
          if (!found) return
          const copy = clone(found.placement)
          walkLayout([copy], (node) => {
            node.id = newId('node')
          })
          found.list.splice(found.index + 1, 0, copy)
        })
      },
      'builder.zoom': ({ by }) => {
        if (!Number.isFinite(Number(by))) return
        drag.cancel(false)
        zoom = Math.max(50, Math.min(150, zoom + Number(by)))
        touch()
      },
      'builder.viewport': ({ device }) => {
        if (!['desktop', 'tablet', 'mobile'].includes(device)) return
        drag.cancel(false)
        previewWidth = device
        touch()
      },
      'builder.moveTo': ({ id: nodeId }, form) => {
        change(current().id, (layout) => movePlacement(layout, nodeId, String(form.get('destination') ?? '')))
      },
      'builder.edit': (_args, form) => {
        const { id } = current()
        const target = String(form.get('__node') ?? '')
        const found = draftOf(id) && locate(draftOf(id).layout, target)
        if (!found) return
        const next = {}
        for (const [name, value] of form.entries())
          if (name !== '__node' && name in (catalogue[found.placement.type]?.settings ?? {}))
            next[name] = String(value)
        change(id, () => Object.assign((found.placement.settings ??= {}), next), `edit:${target}`)
      },
      'builder.add': ({ type }) => {
        const { id, node } = current()
        const placement = { id: newId('node'), type, settings: {} }
        if (type === 'website.columns') placement.slots = { left: [], right: [] }
        change(id, (layout) => {
          const at = node ? locate(layout, node) : null
          const target = node?.includes(':') ? slotTarget(layout, node) : null
          if (target) target.push(placement)
          else if (at) at.list.splice(at.index + 1, 0, placement)
          else layout.push(placement)
        })
        ctx.navigate('builder', { id }, { node: placement.id }, { replace: true })
      },
      'builder.move': ({ id: nodeId, by }) => {
        const { id } = current()
        change(id, (layout) => {
          const at = locate(layout, nodeId)
          const to = at ? at.index + Number(by) : -1
          if (!at || to < 0 || to >= at.list.length) return
          const [moved] = at.list.splice(at.index, 1)
          at.list.splice(to, 0, moved)
        })
      },
      'builder.remove': ({ id: nodeId }) => {
        const { id } = current()
        change(id, (layout) => {
          const at = locate(layout, nodeId)
          if (at) at.list.splice(at.index, 1)
        })
        ctx.navigate('builder', { id }, {}, { replace: true })
      },
      'builder.undo': () => {
        const draft = draftOf(current().id)
        if (!draft?.past.length) return
        draft.future.push(clone(draft.layout))
        draft.layout = draft.past.pop()
        draft.dirty = true
        draft.lastEdit = null
        touch()
      },
      'builder.redo': () => {
        const draft = draftOf(current().id)
        if (!draft?.future.length) return
        draft.past.push(clone(draft.layout))
        draft.layout = draft.future.pop()
        draft.dirty = true
        draft.lastEdit = null
        touch()
      },
      'builder.save': () => save(),
      'builder.preview': async () => {
        if (draftOf(current().id)?.dirty) await save()
        await ctx.navigate('preview', { id: current().id })
      },
      'builder.openSchedule': () =>
        ctx.navigate(
          'builder',
          { id: current().id },
          { ...builderQuery(ctx.route().query), dialog: 'schedule' },
        ),
      'builder.schedule': async (_, form) => {
        const at = scheduleTime(ctx, form)
        const { id } = current()
        if (draftOf(id)?.dirty) await save()
        await publishEntry(ctx, { id, revisionId: draftOf(id).base }, at)
        await ctx.navigate('builder', { id }, { ...builderQuery(ctx.route().query), dialog: undefined })
        await ctx.refresh()
      },
      'builder.cancelSchedule': async () => {
        const { id } = current()
        const { entry } = await ctx.call('website.getEntry', { id })
        await cancelSchedule(ctx, { ...entry, revisionId: draftOf(id).base })
        await ctx.refresh()
      },
      'builder.review': () =>
        ctx.navigate(
          'builder',
          { id: current().id },
          { ...builderQuery(ctx.route().query), dialog: 'checks' },
        ),
      'builder.publish': async () => {
        if (checkBuilderAccessibility(draftOf(current().id).layout).some((i) => i.severity === 'block')) {
          await ctx.navigate(
            'builder',
            { id: current().id },
            { ...builderQuery(ctx.route().query), dialog: 'checks' },
          )
          return
        }
        const { id } = current()
        if (draftOf(id)?.dirty) await save()
        await publishEntry(ctx, { id, revisionId: draftOf(id).base })
        await ctx.refresh()
      },
    },
    dispose: () => {
      drag.dispose()
      if (guarding) removeEventListener('beforeunload', guard)
      if (keyboardAttached) removeEventListener('keydown', keyboard)
    },
  }

  return screen

  async function save() {
    const { id } = current()
    const draft = draftOf(id)
    if (!draft) return
    const layout = clone(draft.layout)
    const { entry } = draft
    const saved = await ctx.call('website.saveEntry', {
      id,
      siteId: ctx.site().id,
      type: entry.type,
      slug: entry.slug,
      path: entry.path,
      title: entry.title,
      locale: entry.locale,
      layout,
      expectedRevisionId: draft.base,
    })
    draft.base = saved.revisionId
    // Edits made while the request was in flight stay unsaved.
    draft.dirty = JSON.stringify(draft.layout) !== JSON.stringify(layout)
    ctx.notify(tr('website.builder.saved'))
    await ctx.refresh()
  }
}

/** Placement ids at any depth, for tests and preflight. */
export const layoutIds = (layout) => {
  const ids = []
  walkLayout(layout, (placement) => ids.push(placement.id))
  return ids
}

export function slotTarget(layout, destination) {
  const separator = destination.lastIndexOf(':')
  if (separator < 0) return null
  return (
    locate(layout, destination.slice(0, separator))?.placement.slots?.[destination.slice(separator + 1)] ??
    null
  )
}
export function slotOptions(layout, excluded) {
  const values = []
  const visit = (list) => {
    for (const node of list) {
      if (node.id === excluded) continue
      for (const [key, children] of Object.entries(node.slots ?? {})) {
        values.push(`${node.id}:${key}`)
        visit(children)
      }
    }
  }
  visit(layout)
  return values
}
export function movePlacement(layout, id, destination) {
  const target = placementSlots(layout, id).find((slot) => slot.destination === destination)
  return target ? movePlacementAt(layout, id, { destination, index: target.list.length }) : false
}
