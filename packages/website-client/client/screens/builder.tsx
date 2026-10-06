import { cancelSchedule, publishEntry, scheduledAt, scheduleTime } from './entry-publishing.tsx'
import { builderDialog } from './builder-dialogs.tsx'
import { builderToolbar } from './builder-toolbar.tsx'
import { createBuilderDrag } from '../builder-drag.ts'
import { locatePlacement, movePlacementAt, planPlacementMove, placementSlots } from '../builder-placement.ts'
import { createBuilderWorkspace } from './builder-workspace.tsx'
import { createBuilderTools, builderPanel, builderQuery } from './builder-tools.tsx'
import { checkBuilderAccessibility } from '../builder-checks.ts'
// Page builder: structure · canvas · inspector over the stored layout (`Placement[]`). The draft
// lives in this island until saved; saving sends the revision it was based on, so a concurrent
// edit is a conflict, never a silent overwrite. The canvas uses the public theme renderer.
import { signal } from '@ketvietlab/ketjs-view'
import { LiveDescription } from '../live-description.tsx'
import { GalleryEditor, galleryUploadPending } from '../gallery-editor.tsx'
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
import { CommandButton, icon } from '../ui.tsx'
import { renderLayout, walkLayout, safeImage, galleryImages } from '../renderer.tsx'
import { newId } from './format.ts'
import type { TreeNode } from '@ketvietlab/design-system'
import type {
  CommandArgs,
  Commands,
  FormField,
  Placement,
  Screen,
  StudioContext,
  Viewport,
} from '../types.ts'
import type { PublicFormData } from '../renderer.tsx'
import type { PlacementTarget } from '../builder-placement.ts'
import type { BuilderDraft, BuilderEntry, PageTemplate, SectionCatalogue } from './builder-types.ts'

const HISTORY_LIMIT = 50

/** A form in the site's list; only open ones preview on the canvas. */
type FormChoice = { id: string; title: string; active: boolean }
/** `website_studio.visitorForm`: what a visitor would be shown for one form. */
type VisitorForm = { form: { id: string; title: string; consentLabel?: string }; fields: FormField[] }
type BuilderScreen = Screen<BuilderEntry> & { commands: Commands; dispose(): void }

/** Locate a placement and the array that holds it, at any depth. */
export const locate = locatePlacement

const clone = <T,>(value: T): T => structuredClone(value)

export function createBuilder(ctx: StudioContext): BuilderScreen {
  const tr = ctx.tr
  /** entryId → { entry, layout, base, dirty, past, future, lastEdit } — one draft per page, kept across navigation. */
  const drafts = new Map<string, BuilderDraft>()
  const version = signal(0)
  const touch = () => version.set((n) => n + 1)
  const guard = (event: Event) => {
    if ([...drafts.values()].some((d) => d.dirty)) event.preventDefault()
  }
  let guarding = false
  let templates: PageTemplate[] = []
  let interactive: { entryId: string; url: string } | null = null
  let previewWidth: Viewport = 'desktop'
  let zoom = 100
  let dialogOpener: HTMLElement | null = null
  let lastDialog: string | null = null
  const closeDialog = async () => {
    ;(globalThis.document?.getElementById('website-builder-dialog') as HTMLDialogElement | null)?.close()
    lastDialog = null
    await ctx.navigate(
      'builder',
      { id: current().id },
      { ...builderQuery(ctx.route().query), dialog: undefined },
    )
    if (dialogOpener?.isConnected) dialogOpener.focus()
  }
  let focusedField: string | null = null
  let catalogue: SectionCatalogue = {}
  // The site's forms for the form block: the list feeds its picker, the open ones its canvas preview.
  let forms: FormChoice[] = []
  let formPreviews: Record<string, PublicFormData> = {}

  const current = () => {
    const route = ctx.route()
    return {
      id: route.params.id,
      node: route.query.node ?? drafts.get(route.params.id)?.layout[0]?.id ?? null,
    }
  }
  const draftOf = (id: string) => drafts.get(id)
  // A closed or unreadable form previews as missing, exactly as visitors would not see it.
  const quietly = <T,>(signal: AbortSignal | undefined, promise: Promise<T>): Promise<T | null> =>
    promise.catch((error: unknown) => {
      if (signal?.aborted) throw error
      return null
    })
  const readForms = async (signal: AbortSignal) => {
    const siteId = ctx.site().id
    forms =
      (
        await quietly(
          signal,
          ctx.call<{ rows: FormChoice[] }>('website_form.listForms', { siteId }, { signal }),
        )
      )?.rows ?? []
    const previews = await Promise.all(
      forms
        .filter((form) => form.active)
        .map((form) =>
          quietly(
            signal,
            ctx.call<VisitorForm>('website_studio.visitorForm', { siteId, id: form.id }, { signal }),
          ),
        ),
    )
    formPreviews = Object.fromEntries(
      previews
        .filter((preview): preview is VisitorForm => !!preview)
        .map(({ form, fields }) => [
          form.id,
          { id: form.id, title: form.title, fields, consentText: form.consentLabel || null },
        ]),
    )
  }
  /** What `website_form.publicForm` would answer for each form placement, from the forms read above. */
  const formSectionData = (layout: Placement[]) => {
    const data: Record<string, PublicFormData> = {}
    walkLayout(layout, (placement) => {
      const settings = placement.settings ?? {}
      const form = placement.type === 'website_form.form' && formPreviews[settings.formId as string]
      if (form)
        data[placement.id] = {
          ...form,
          heading: settings.heading || null,
          description: (settings.description as string | undefined) || null,
        }
    })
    return data
  }
  const change = (id: string, mutate: (layout: Placement[]) => unknown, coalesce: string | null = null) => {
    interactive = null
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
    if (!guarding && typeof globalThis.addEventListener === 'function') {
      addEventListener('beforeunload', guard)
      guarding = true
    }
    touch()
  }

  const tools = createBuilderTools(ctx, {
    draft: () => draftOf(current().id)!,
    change: (fn) => change(current().id, fn),
    save,
    touch,
  })

  const workspace = createBuilderWorkspace(ctx, {
    draft: () => draftOf(current().id)!,
    templates: () => templates,
    change: (fn) => change(current().id, fn),
    save,
    touch,
  })
  const nodeLabel = (placement: Placement | undefined) =>
    String(
      placement?.settings?.heading || catalogue[placement?.type as string]?.title || tr('website.drag.block'),
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
    commit: (id: string, target: PlacementTarget) => {
      const plan = planPlacementMove(draftOf(current().id)?.layout ?? [], id, target)
      if (!plan || plan.noop || !ctx.can('website.content.write') || ctx.busy()) return
      change(current().id, (layout) => movePlacementAt(layout, id, target))
    },
    label: nodeLabel,
    tr,
    onError: (error) => ctx.notify((error as Error).message),
  })
  const dragHandle = (placement: Placement) =>
    ctx.can('website.content.write') ? (
      <span class="website-builder-drag-handle" data-builder-drag-id={placement.id}>
        <IconButton
          icon={icon('grip-vertical')}
          label={tr('website.drag.handle', { name: nodeLabel(placement) })}
          variant="secondary"
          describedBy="website-builder-drag-instructions"
          disabled={ctx.busy()}
          name="builder-drag"
          value={placement.id}
        />
      </span>
    ) : null
  const emptyDropSlot = (destination: string) => (
    <div class="website-builder-empty-slot">
      {tr(
        destination.endsWith(':left')
          ? 'website.drag.emptyLeft'
          : destination.endsWith(':right')
            ? 'website.drag.emptyRight'
            : 'website.drag.emptyRoot',
      )}
    </div>
  )
  let keyboardAttached = false
  let screen: BuilderScreen
  const keyboard = (event: KeyboardEvent) => {
    if (ctx.route().key !== 'builder' || drag.active()) return
    const typing = (event.target as Element | null)?.closest?.(
      'input,textarea,select,[contenteditable="true"]',
    )
    let action: string | null = null,
      args: CommandArgs = {}
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
      Promise.resolve(screen.commands[`builder.${action}`](args)).catch((error: Error) =>
        ctx.notify(error.message),
      )
    }
  }
  const selectOnCanvas = (event: Event) => {
    const target = event.target as Element
    if (event.defaultPrevented || target.closest?.('[data-builder-drag-id]')) return
    const node = target.closest?.<HTMLElement>('[data-node]')
    if (!node) {
      if (!interactive && target.closest?.('a[href]')) event.preventDefault()
      return
    }
    event.preventDefault()
    ctx.navigate(
      'builder',
      { id: current().id },
      { ...builderQuery(ctx.route().query), node: node.dataset.node },
      { replace: true },
    )
  }

  const treeNodes = (layout: Placement[], sections: SectionCatalogue, selected: string | null): TreeNode[] =>
    layout.map((placement) => ({
      id: placement.id,
      label: (
        <span class="website-builder-tree-label" data-builder-drop-node={placement.id}>
          {ctx.can('website.content.write') ? (
            <span class="website-builder-tree-grip" data-builder-drag-id={placement.id} aria-hidden="true">
              {icon('grip-vertical')}
            </span>
          ) : null}
          <span>{nodeLabel(placement)}</span>
        </span>
      ),
      href: ctx.href('builder', { id: current().id }, { node: placement.id }),
      active: placement.id === selected,
      expanded: true,
      children: placement.slots
        ? Object.entries(placement.slots).map(([slot, children]) => ({
            id: `${placement.id}:${slot}`,
            label: (
              <span class="website-builder-tree-slot" data-builder-drop-slot={`${placement.id}:${slot}`}>
                {tr(
                  slot === 'left'
                    ? 'website.builder.slotLeft'
                    : slot === 'right'
                      ? 'website.builder.slotRight'
                      : 'website.drag.slot',
                )}
                {children.length ? '' : ` · ${tr('website.drag.empty')}`}
              </span>
            ),
            href: ctx.href('builder', { id: current().id }, { node: `${placement.id}:${slot}` }),
            expanded: true,
            children: treeNodes(children, sections, selected),
          }))
        : [],
    }))

  const field = (name: string, kind: string, value: string | undefined, disabled: boolean) => {
    const label = tr(`website.builder.setting.${name}`)
    const common = { id: `builder-${name}`, name, label, value: value ?? '', disabled }
    if (name === 'images') {
      const selected = locate(draftOf(current().id)!.layout, current().node ?? '')?.placement
      return selected
        ? GalleryEditor(ctx, {
            entryId: current().id,
            images: galleryImages(selected.settings ?? {}),
            disabled,
            update: (images) =>
              change(
                current().id,
                () => {
                  selected.settings!.images = JSON.stringify(images)
                },
                `gallery:${selected.id}`,
              ),
          })
        : null
    }
    if (name === 'galleryLayout')
      return (
        <Select
          {...common}
          value={value || 'grid'}
          options={['grid', 'slideshow', 'activity', 'clients'].map((value) => ({
            value,
            label: tr(`website.gallery.${value}`),
          }))}
        />
      )
    if (name === 'rows')
      return (
        <Select
          {...common}
          value={value || '1'}
          options={['1', '2', '3'].map((value) => ({ value, label: value }))}
        />
      )
    if (name === 'visibility')
      return (
        <Select
          {...common}
          value={value || 'all'}
          options={['all', 'desktop', 'mobile'].map((value) => ({
            value,
            label: tr(`website.builder.visibility.${value}`),
          }))}
        />
      )
    if (name === 'formId')
      return (
        <Select
          {...common}
          options={[
            { value: '', label: tr('website.builder.form.choose') },
            ...forms.map((form) => ({ value: form.id, label: form.title })),
          ]}
        />
      )
    if (name === 'align')
      return (
        <Select
          {...common}
          value={value ?? 'start'}
          options={[
            { value: 'start', label: tr('website.builder.align.start') },
            { value: 'center', label: tr('website.builder.align.center') },
          ]}
        />
      )
    if (kind.startsWith('ref:'))
      return (
        <LinkButton
          label={tr('website.workspace.changeImage')}
          href={ctx.href(
            'builder',
            { id: current().id },
            { ...builderQuery(ctx.route().query), dialog: 'media', node: current().node },
          )}
        />
      )
    if (name === 'body') {
      const draft = draftOf(current().id)
      const selected = draft && locate(draft.layout, current().node ?? '')?.placement
      if (selected?.type === 'website.rich_text')
        return (
          <LiveDescription
            id={`builder-${selected.id}`}
            value={String(selected.settings?.bodyDoc ?? '')}
            text={value ?? ''}
            label={label}
            readOnly={disabled}
            field
            documentField="bodyDoc"
            textField="body"
            notify
          />
        )
      return <TextArea {...common} />
    }
    return <TextField {...common} required={!kind.endsWith('?')} />
  }

  const inspector = (
    sections: SectionCatalogue,
    placement: Placement | null | undefined,
    canWrite: boolean,
  ) => {
    if (!placement)
      return (
        <EmptyState
          title={tr('website.builder.nothingSelected')}
          message={tr('website.builder.selectHint')}
        />
      )
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
            'bodyDoc',
            ...(placement.type === 'website.gallery' ? ['image', 'image2'] : []),
          ].includes(name),
      )
      .filter(([name]) =>
        tab === 'advanced'
          ? name === 'visibility'
          : tab === 'design'
            ? name === 'align'
            : !['align', 'visibility'].includes(name),
      )
    return (
      <Stack
        divided
        items={[
          <nav class="website-inspector-tabs" aria-label={tr('website.workspace.inspectorTabs')}>
            {['content', 'design', 'advanced']
              .map((key) => (
                <LinkButton
                  label={tr(`website.workspace.${key}`)}
                  href={ctx.href(
                    'builder',
                    { id: current().id },
                    {
                      ...builderQuery(ctx.route().query),
                      node: placement.id,
                      inspector: key,
                      dialog: undefined,
                    },
                  )}
                />
              ))
              .reduce(
                (a, b) => (
                  <>
                    {a}
                    {b}
                  </>
                ),
                <></>,
              )}
          </nav>,
          placement.settings?.image ? (
            <figure class="website-media-preview">
              <img src={safeImage(placement.settings.image)} alt={placement.settings.alt ?? ''} />
              <LinkButton
                label={tr('website.workspace.changeImage')}
                href={ctx.href(
                  'builder',
                  { id: current().id },
                  { ...builderQuery(ctx.route().query), dialog: 'media', node: placement.id },
                )}
              />
            </figure>
          ) : null,
          <form id="builder-destination">
            <Select
              id="builder-destination-select"
              name="destination"
              label={tr('website.builder.destination')}
              options={[
                { value: '', label: tr('website.builder.root') },
                ...slotOptions(draftOf(current().id)!.layout, placement.id).map((value) => ({
                  value,
                  label: tr('website.builder.slotDestination', {
                    section:
                      sections[
                        locate(draftOf(current().id)!.layout, value.slice(0, value.lastIndexOf(':')))
                          ?.placement.type as string
                      ]?.title ?? tr('website.builder.structure'),
                    slot: value.endsWith(':left') ? tr('website.builder.left') : tr('website.builder.right'),
                  }),
                })),
              ]}
              disabled={!canWrite}
            />
            <CommandButton
              label={tr('website.builder.moveTo')}
              command="builder.moveTo"
              args={{ id: placement.id }}
              type="submit"
              form="builder-destination"
              disabled={!canWrite}
            />
          </form>,
          <form data-live="builder.edit" novalidate>
            <input type="hidden" name="__node" value={placement.id} />
            <Stack
              items={visibleFields.map(([name, kind]) =>
                field(name, kind, placement.settings?.[name] as string | undefined, !canWrite),
              )}
            />
          </form>,
          tab === 'design'
            ? workspace.view(Object.keys(placement.slots ?? {}).length ? 'layout' : 'responsive', sections, {
                embedded: true,
              })
            : null,
          tab === 'advanced' ? workspace.view('visibility', sections, { embedded: true }) : null,
          <Section
            title={tr('website.builder.arrange')}
            body={
              <ActionGroup
                label={tr('website.builder.arrange')}
                actions={[
                  <CommandButton
                    label={tr('website.builder.moveUp')}
                    command="builder.move"
                    args={{ ...args, by: '-1' }}
                    disabled={!canWrite}
                  />,
                  <CommandButton
                    label={tr('website.builder.moveDown')}
                    command="builder.move"
                    args={{ ...args, by: '1' }}
                    disabled={!canWrite}
                  />,
                  <CommandButton
                    label={tr('website.builder.duplicate')}
                    command="builder.duplicate"
                    args={args}
                    disabled={!canWrite}
                  />,
                  <CommandButton
                    label={tr('website.builder.remove')}
                    command="builder.remove"
                    args={args}
                    variant="destructive"
                    disabled={!canWrite}
                  />,
                ]}
              />
            }
          />,
        ]}
      />
    )
  }

  screen = {
    readKey: (route) => route.params.id,
    read: async (route, signal) => {
      drag.cancel(false)
      drag.attach(globalThis.document)
      const value = await ctx.call<BuilderEntry>('website.getEntry', { id: route.params.id }, { signal })
      if (value.entry.type === 'post') {
        await ctx.navigate('post-edit', { id: value.entry.id })
        return value
      }
      catalogue = value.sections
      if (ctx.can('website.content.write'))
        templates = (
          await ctx.call<{ rows: PageTemplate[] }>(
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
      if (!keyboardAttached && typeof globalThis.addEventListener === 'function') {
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
        return <WorkspacePage title={tr('website.loading')} layout="canvas" body={null} />
      const draft = draftOf(entry.id)!
      const { node } = current()
      const selected = node ? locate(draft.layout, node)?.placement : null
      const canWrite = ctx.can('website.content.write')
      const panel = builderPanel(ctx.route().query.panel)
      const templatePreview =
        panel === 'library' && ctx.route().query.section === 'templates' ? workspace.previewTemplate() : null
      const busy = ctx.busy()
      const dialog = ctx.route().query.dialog
      if (dialog && ['commands', 'checks', 'schedule', 'media'].includes(dialog) && globalThis.document)
        queueMicrotask(() => {
          const element = document.getElementById('website-builder-dialog') as HTMLDialogElement | null
          if (!element || element.open) return
          if (!lastDialog) dialogOpener = document.activeElement as HTMLElement | null
          lastDialog = dialog
          element.showModal()
          element
            .querySelector<HTMLElement>(dialog === 'commands' ? 'input' : '[data-ui="modal-close"]')
            ?.focus()
        })
      else lastDialog = null
      const focus = ctx.route().query.field
      if (focus && focus !== focusedField && globalThis.document) {
        focusedField = focus
        queueMicrotask(() => document.getElementById(`builder-${focus}`)?.focus())
      }
      return (
        <WorkspacePage
          title={entry.title}
          meta={
            <>
              <LinkButton
                label={tr(entry.type === 'post' ? 'website.route.posts' : 'website.route.pages')}
                leading={icon('chevron-left')}
                variant="tertiary"
                href={ctx.href(entry.type === 'post' ? 'posts' : 'pages')}
              />
              <Menu
                id="builder-pages"
                label={tr('website.builder.switchPage')}
                trigger={
                  <>
                    <span class="website-builder-page-icon" aria-hidden="true">
                      {icon('file-text')}
                    </span>
                    <span class="website-builder-page-trigger">{tr('website.builder.switchPage')}</span>
                    <span class="website-builder-page-chevron" aria-hidden="true">
                      {icon('chevron-down')}
                    </span>
                  </>
                }
                size="compact"
                items={workspace.pages().map((page) => ({
                  id: page.id,
                  label: page.title,
                  href: ctx.href('builder', { id: page.id }),
                  leading: page.id === entry.id ? icon('check') : undefined,
                }))}
              />
            </>
          }
          status={
            <span class="website-builder-state">
              <Status
                label={tr(draft.dirty ? 'website.builder.unsaved' : 'website.builder.draftSaved')}
                tone={draft.dirty ? 'warning' : 'neutral'}
              />
              {workspace.live() ? (
                <Status
                  label={tr(
                    draft.dirty || workspace.live() !== draft.base
                      ? 'website.builder.liveOlder'
                      : 'website.builder.liveCurrent',
                  )}
                  tone="positive"
                />
              ) : // Scheduled says more than "not published" about the same page.
              entry.publishAt ? null : (
                <Status label={tr('website.builder.notPublished')} tone="neutral" />
              )}
              {entry.publishAt ? (
                <Status
                  label={`${tr('website.entry.state.scheduled')} · ${scheduledAt(ctx, entry.publishAt)}`}
                  tone="info"
                />
              ) : null}
            </span>
          }
          layout="canvas"
          actions={builderToolbar(ctx, {
            entry,
            draft,
            previewWidth,
            zoom,
            busy,
            canWrite,
            interactive: interactive?.entryId === entry.id,
          })}
          body={
            <>
              <div class="website-builder-workspace" data-builder-drag-root="">
                {tools.navigation()}
                {canWrite ? (
                  <p class="website-builder-drag-sr" id="website-builder-drag-instructions">
                    {tr('website.drag.instructions')}
                  </p>
                ) : null}
                <span
                  class="website-builder-drag-sr"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  data-builder-drag-status=""
                />
                <div
                  class="website-builder"
                  data-theme-interactive={interactive?.entryId === entry.id ? 'true' : null}
                  data-panel={panel}
                  data-template-preview={templatePreview ? 'true' : null}
                >
                  {panel !== 'structure' || ctx.route().query.section === 'shared' ? (
                    panel === 'library' ? (
                      <div class="website-builder-panel">
                        <Surface
                          title={tr('website.tools.library')}
                          body={
                            <TabbedView
                              id="builder-library"
                              label={tr('website.tools.library')}
                              items={['blocks', 'templates'].map((section) => ({
                                id: section,
                                label: tr(
                                  section === 'blocks'
                                    ? 'website.builder.blocks'
                                    : 'website.workspace.templates',
                                ),
                                href: ctx.href(
                                  'builder',
                                  { id: entry.id },
                                  { panel: 'library', section, node },
                                ),
                                active:
                                  (ctx.route().query.section === 'templates') === (section === 'templates'),
                              }))}
                              body={workspace.view(
                                ctx.route().query.section === 'templates' ? 'templates' : 'library',
                                sections,
                                { embedded: true },
                              )}
                            />
                          }
                        />
                      </div>
                    ) : (
                      workspace.view(panel === 'structure' ? 'shared' : panel, sections)
                    )
                  ) : (
                    <div class="website-builder-panel">
                      <Surface
                        title={tr('website.builder.structure')}
                        body={
                          <Stack
                            items={[
                              <Section
                                title={tr('website.workspace.header')}
                                body={
                                  <LinkButton
                                    label={tr('website.workspace.shared')}
                                    href={ctx.href(
                                      'builder',
                                      { id: entry.id },
                                      { panel: 'structure', section: 'shared' },
                                    )}
                                  />
                                }
                              />,
                              draft.layout.length ? (
                                <div
                                  class="website-builder-tree-scroll"
                                  data-builder-surface="tree"
                                  data-builder-drop-slot=""
                                >
                                  <Tree
                                    label={tr('website.builder.structure')}
                                    nodes={treeNodes(draft.layout, sections, node)}
                                  />
                                </div>
                              ) : (
                                <EmptyState
                                  title={tr('website.builder.emptyTitle')}
                                  message={tr('website.builder.emptyMessage')}
                                />
                              ),
                              <Section
                                title={tr('website.workspace.footer')}
                                body={
                                  <LinkButton
                                    label={tr('website.workspace.shared')}
                                    href={ctx.href(
                                      'builder',
                                      { id: entry.id },
                                      { panel: 'structure', section: 'shared' },
                                    )}
                                  />
                                }
                              />,
                              <LinkButton
                                label={tr('website.workspace.addSection')}
                                href={ctx.href('builder', { id: entry.id }, { panel: 'library', node })}
                              />,
                              <small>{tr('website.workspace.moveHint')}</small>,
                            ]}
                          />
                        }
                      />
                    </div>
                  )}
                  <Surface
                    body={
                      <>
                        {templatePreview ? (
                          <Notice
                            title={tr('website.builder.templatePreview', { name: templatePreview.title })}
                            message={tr('website.builder.templatePreviewHelp')}
                            tone="info"
                          />
                        ) : null}
                        {/* biome-ignore lint/a11y/noStaticElementInteractions: picking a block on the canvas is a pointer shortcut; the layer list selects the same block by keyboard. */}
                        {/* biome-ignore lint/a11y/useKeyWithClickEvents: picking a block on the canvas is a pointer shortcut; the layer list selects the same block by keyboard. */}
                        <div
                          class="website-builder__canvas"
                          data-builder-surface="canvas"
                          data-viewport={previewWidth}
                          style={`zoom:${zoom / 100}`}
                          onClick={templatePreview ? undefined : selectOnCanvas}
                        >
                          {interactive?.entryId === entry.id ? (
                            <>
                              <LinkButton
                                label={tr('website.builder.openInteractive')}
                                href={interactive.url}
                              />
                              <iframe
                                title={tr('website.builder.interactiveCanvas')}
                                src={interactive.url}
                                sandbox="allow-scripts"
                                referrerpolicy="no-referrer"
                                style="width:100%;height:75vh;min-height:480px;border:0;background:white"
                              />
                            </>
                          ) : (
                            workspace.frame(
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
                                      unknownLabel: (type: string) =>
                                        tr('website.builder.unknownSection', { type }),
                                      sectionData: formSectionData(draft.layout),
                                      formText: {
                                        send: tr('website.formJourney.send'),
                                        missing: tr('website.builder.form.missing'),
                                      },
                                    },
                              ),
                            )
                          )}
                        </div>
                      </>
                    }
                  />
                  {templatePreview ? null : (
                    <div class="website-builder-panel">
                      <Surface
                        title={
                          selected
                            ? (sections[selected.type]?.title ?? selected.type)
                            : tr('website.builder.inspector')
                        }
                        body={
                          <>
                            {!canWrite ? (
                              <Notice
                                title={tr('website.readonly.title')}
                                message={tr('website.readonly.message')}
                                tone="warning"
                              />
                            ) : null}
                            {inspector(sections, selected, canWrite)}
                          </>
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
              <footer class="website-builder-status">
                {tr('website.workspace.next')} · {tr('website.workspace.quick')}
              </footer>
              {builderDialog(ctx, { draft, sections, workspace, close: closeDialog })}
            </>
          }
        />
      )
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
        previewWidth = device as Viewport
        touch()
      },
      'builder.moveTo': ({ id: nodeId }, form) => {
        change(current().id, (layout) =>
          movePlacement(layout, nodeId, String(form!.get('destination') ?? '')),
        )
      },
      'builder.edit': (_args, form) => {
        const { id } = current()
        const target = String(form!.get('__node') ?? '')
        const found = draftOf(id) && locate(draftOf(id)!.layout, target)
        if (!found) return
        const next: Record<string, string> = {}
        for (const [name, value] of form!.entries())
          if (name !== '__node' && name in (catalogue[found.placement.type]?.settings ?? {}))
            next[name] = String(value)
        change(id, () => Object.assign((found.placement.settings ??= {}), next), `edit:${target}`)
      },
      'builder.add': ({ type }) => {
        const { id, node } = current()
        const placement: Placement = { id: newId('node'), type, settings: {} }
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
        draft.layout = draft.past.pop()!
        draft.dirty = true
        draft.lastEdit = null
        touch()
      },
      'builder.redo': () => {
        const draft = draftOf(current().id)
        if (!draft?.future.length) return
        draft.past.push(clone(draft.layout))
        draft.layout = draft.future.pop()!
        draft.dirty = true
        draft.lastEdit = null
        touch()
      },
      'builder.save': () => save(),
      'builder.interact': async () => {
        if (interactive?.entryId === current().id) {
          interactive = null
          touch()
          return
        }
        if (draftOf(current().id)?.dirty) await save()
        const link = await ctx.call<{ token: string }>('website_studio.createPreview', {
          siteId: ctx.site().id,
          id: current().id,
          revisionId: draftOf(current().id)!.base,
          audience: 'link',
          minutes: 5,
        })
        const data = await ctx.call<{ preview: { url: string | null } }>('website_studio.preview', {
          siteId: ctx.site().id,
          id: current().id,
          token: link.token,
        })
        if (!data.preview?.url) throw new Error(tr('website.builder.interactiveUnavailable'))
        const url = new URL(data.preview.url, globalThis.location?.href ?? 'http://atlas.invalid')
        url.searchParams.set('themeInteractive', '1')
        interactive = { entryId: current().id, url: url.href }
        touch()
      },
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
        const at = scheduleTime(ctx, form!)
        const { id } = current()
        if (draftOf(id)?.dirty) await save()
        await publishEntry(ctx, { id, revisionId: draftOf(id)!.base }, at)
        await ctx.navigate('builder', { id }, { ...builderQuery(ctx.route().query), dialog: undefined })
        await ctx.refresh()
      },
      'builder.cancelSchedule': async () => {
        const { id } = current()
        const { entry } = await ctx.call<BuilderEntry>('website.getEntry', { id })
        await cancelSchedule(ctx, { ...entry, revisionId: draftOf(id)!.base })
        await ctx.refresh()
      },
      'builder.review': () =>
        ctx.navigate(
          'builder',
          { id: current().id },
          { ...builderQuery(ctx.route().query), dialog: 'checks' },
        ),
      'builder.publish': async () => {
        if (checkBuilderAccessibility(draftOf(current().id)!.layout).some((i) => i.severity === 'block')) {
          await ctx.navigate(
            'builder',
            { id: current().id },
            { ...builderQuery(ctx.route().query), dialog: 'checks' },
          )
          return
        }
        const { id } = current()
        if (draftOf(id)?.dirty) await save()
        await publishEntry(ctx, { id, revisionId: draftOf(id)!.base })
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
    if (galleryUploadPending(current().id)) throw new Error(tr('website.taxonomy.imageUploading'))
    if (
      typeof document !== 'undefined' &&
      [...document.querySelectorAll<HTMLElement>('[data-live="builder.edit"][data-uploading]')].some(
        (form) => Number(form.dataset.uploading) > 0,
      )
    )
      throw new Error(tr('website.taxonomy.imageUploading'))
    const { id } = current()
    const draft = draftOf(id)
    if (!draft) return
    const layout = clone(draft.layout)
    const { entry } = draft
    const saved = await ctx.call<{ revisionId: string }>('website.saveEntry', {
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
export const layoutIds = (layout: Placement[]) => {
  const ids: string[] = []
  walkLayout(layout, (placement) => ids.push(placement.id))
  return ids
}

export function slotTarget(layout: Placement[], destination: string) {
  const separator = destination.lastIndexOf(':')
  if (separator < 0) return null
  return (
    locate(layout, destination.slice(0, separator))?.placement.slots?.[destination.slice(separator + 1)] ??
    null
  )
}
export function slotOptions(layout: Placement[], excluded: string) {
  const values: string[] = []
  const visit = (list: Placement[]) => {
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
export function movePlacement(layout: Placement[], id: string, destination: string) {
  const target = placementSlots(layout, id).find((slot) => slot.destination === destination)
  return target ? movePlacementAt(layout, id, { destination, index: target.list.length }) : false
}
