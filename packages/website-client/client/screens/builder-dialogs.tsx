import { EntrySchedule } from './entry-publishing.tsx'
import {
  ModalSheet,
  Stack,
  Field,
  LinkButton,
  Notice,
  ActionGroup,
  ToastRegion,
} from '@ketvietlab/design-system'
import { CommandButton } from '../ui.tsx'
import { BUILDER_PANELS, builderQuery } from './builder-tools.tsx'
import { checkBuilderAccessibility } from '../builder-checks.ts'
import { BuilderRecords } from './builder-records.tsx'
import type { JSXChild } from '@ketvietlab/ketjs-view/jsx-runtime'
import type { StudioContext } from '../types.ts'
import type { BuilderDraft, SectionCatalogue } from './builder-types.ts'
import type { createBuilderWorkspace } from './builder-workspace.tsx'

export type BuilderDialogProps = {
  draft: BuilderDraft
  sections: SectionCatalogue
  workspace: ReturnType<typeof createBuilderWorkspace>
  close: () => unknown
}

export function builderDialog(ctx: StudioContext, { draft, sections, workspace, close }: BuilderDialogProps) {
  const kind = ctx.route().query.dialog
  if (!kind || !['commands', 'checks', 'schedule', 'media'].includes(kind)) return null
  const tr = ctx.tr
  const t = (key: string, args?: Record<string, string | number>) => tr(`website.tools.${key}`, args)
  const base = { ...builderQuery(ctx.route().query), dialog: undefined }
  const link = (label: string, query: Record<string, string | undefined>) => (
    <LinkButton label={label} href={ctx.href('builder', { id: draft.entry.id }, { ...base, ...query })} />
  )
  const issues = checkBuilderAccessibility(draft.layout)
  const command = (key: string) => (
    <CommandButton
      label={tr(`website.builder.${key}`)}
      command={`builder.${key}`}
      disabled={
        ctx.busy() ||
        (['save', 'undo', 'redo'].includes(key) && !ctx.can('website.content.write')) ||
        (key === 'publish' && !ctx.can('website.publish')) ||
        (key === 'save' && !draft.dirty) ||
        (key === 'undo' && !draft.past.length) ||
        (key === 'redo' && !draft.future.length)
      }
    />
  )
  const title = tr(`website.builder.dialog.${kind}`)
  let body: JSXChild, actions: JSXChild
  if (kind === 'commands')
    body = (
      <div
        onInput={(event: Event) => {
          const query = (event.target as HTMLInputElement).value.toLocaleLowerCase('vi').trim()
          for (const item of (event.currentTarget as Element).querySelectorAll<HTMLElement>(
            '[data-builder-command-item]',
          ))
            item.hidden = !item.textContent!.toLocaleLowerCase('vi').includes(query)
        }}
      >
        <Field
          id="builder-command-search"
          name="builder-command-search"
          label={tr('website.builder.commandSearch')}
          type="search"
        />
        <Stack
          items={[
            ...BUILDER_PANELS.filter(
              (panel) =>
                !draft.entry.catalog ||
                (draft.entry.catalog.mode === 'product'
                  ? panel === 'structure'
                  : ['structure', 'library', 'styles'].includes(panel)),
            ).map((panel) => link(tr(`website.tools.${panel}`), { panel, section: undefined })),
            ...(draft.entry.catalog
              ? ['save', 'undo', 'redo']
              : ['save', 'undo', 'redo', 'preview', 'publish']
            ).map(command),
            ...workspace
              .pages()
              .map((entry) => (
                <LinkButton label={entry.title} href={ctx.href('builder', { id: entry.id })} />
              )),
          ].map((item) => <div data-builder-command-item>{item}</div>)}
        />
      </div>
    )
  if (kind === 'checks')
    body = (
      <Stack
        items={[
          <Notice
            title={t('issueCount', { count: issues.filter((i) => i.severity === 'block').length })}
            message={t('a11yHelp')}
            tone={issues.some((i) => i.severity === 'block') ? 'warning' : 'positive'}
          />,
          BuilderRecords({
            rows: issues,
            columns: [
              { key: 'issue', label: t('issue'), cell: (r) => t(r.code) },
              { key: 'severity', label: t('severity'), cell: (r) => t(r.severity) },
              {
                key: 'fix',
                label: t('fix'),
                cell: (r) => link(t('fix'), { panel: 'structure', node: r.nodeId, inspector: 'content' }),
              },
            ],
          }),
        ]}
      />
    )
  if (kind === 'checks')
    actions = (
      <ActionGroup
        label={title}
        actions={[
          <CommandButton
            label={tr('website.builder.publish')}
            command="builder.publish"
            variant="primary"
            disabled={ctx.busy() || !ctx.can('website.publish') || issues.some((i) => i.severity === 'block')}
          />,
        ]}
      />
    )
  if (kind === 'schedule')
    body = (
      <form id="builder-entry-schedule">
        {EntrySchedule(ctx, draft.entry, {
          command: 'builder.schedule',
          cancel: 'builder.cancelSchedule',
          form: 'builder-entry-schedule',
        })}
      </form>
    )
  if (kind === 'media') body = workspace.view('media', sections, { embedded: true })
  // A modal dialog sits above the Studio's toast region and makes it inert: a command run from
  // here (a past schedule time, a conflict) reports inside the dialog instead.
  const notices = <ToastRegion label={tr('website.toast.region')} toasts={ctx.toasts()} />
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Delegates clicks from the sheet's buttons; the native dialog handles Escape.
    <dialog
      id="website-builder-dialog"
      class="website-confirm-dialog"
      aria-labelledby="website-builder-sheet-title"
      onCancel={(event: Event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event: Event) => {
        if ((event.target as Element).closest('[data-ui="modal-close"]')) close()
      }}
    >
      <ModalSheet
        id="website-builder-sheet"
        title={title}
        mode="client"
        presentation="dialog"
        dialogSemantics="parent"
        closeLabel={tr('website.action.close')}
        body={body}
        actions={actions}
      />
      {notices}
    </dialog>
  )
}
