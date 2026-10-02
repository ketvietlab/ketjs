import { EntrySchedule } from './entry-publishing.mjs'
import { html } from '@ketvietlab/ketjs-view'
import {
  ModalSheet,
  Stack,
  TextField,
  LinkButton,
  Notice,
  ActionGroup,
  ToastRegion,
} from '@ketvietlab/design-system'
import { h, CommandButton } from '../ui.mjs'
import { BUILDER_PANELS, builderQuery } from './builder-tools.mjs'
import { checkBuilderAccessibility } from '../builder-checks.mjs'
import { BuilderRecords } from './builder-records.mjs'

export function builderDialog(ctx, { draft, sections, workspace, close }) {
  const kind = ctx.route().query.dialog
  if (!['commands', 'checks', 'schedule', 'media'].includes(kind)) return null
  const tr = ctx.tr
  const t = (key, args) => tr(`website.tools.${key}`, args)
  const base = { ...builderQuery(ctx.route().query), dialog: undefined }
  const link = (label, query) =>
    h(LinkButton, { label, href: ctx.href('builder', { id: draft.entry.id }, { ...base, ...query }) })
  const issues = checkBuilderAccessibility(draft.layout)
  const command = (key) =>
    CommandButton({
      label: tr(`website.builder.${key}`),
      command: `builder.${key}`,
      disabled:
        ctx.busy() ||
        (['save', 'undo', 'redo'].includes(key) && !ctx.can('website.content.write')) ||
        (key === 'publish' && !ctx.can('website.publish')) ||
        (key === 'save' && !draft.dirty) ||
        (key === 'undo' && !draft.past.length) ||
        (key === 'redo' && !draft.future.length),
    })
  const title = tr(`website.builder.dialog.${kind}`)
  let body, actions
  if (kind === 'commands')
    body = html`<div on:input=${(event) => {
      const query = event.target.value.toLocaleLowerCase('vi').trim()
      for (const item of event.currentTarget.querySelectorAll('[data-builder-command-item]'))
        item.hidden = !item.textContent.toLocaleLowerCase('vi').includes(query)
    }}>${h(TextField, { id: 'builder-command-search', label: tr('website.builder.commandSearch'), type: 'search' })}${h(
      Stack,
      {
        items: [
          ...BUILDER_PANELS.map((panel) => link(tr(`website.tools.${panel}`), { panel, section: undefined })),
          ...['save', 'undo', 'redo', 'preview', 'publish'].map(command),
          ...workspace
            .pages()
            .map((entry) =>
              h(LinkButton, { label: entry.title, href: ctx.href('builder', { id: entry.id }) }),
            ),
        ].map((item) => html`<div data-builder-command-item>${item}</div>`),
      },
    )}</div>`
  if (kind === 'checks')
    body = h(Stack, {
      items: [
        h(Notice, {
          title: t('issueCount', { count: issues.filter((i) => i.severity === 'block').length }),
          message: t('a11yHelp'),
          tone: issues.some((i) => i.severity === 'block') ? 'warning' : 'positive',
        }),
        h(BuilderRecords, {
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
      ],
    })
  if (kind === 'checks')
    actions = h(ActionGroup, {
      label: title,
      actions: [
        CommandButton({
          label: tr('website.builder.publish'),
          command: 'builder.publish',
          variant: 'primary',
          disabled: ctx.busy() || !ctx.can('website.publish') || issues.some((i) => i.severity === 'block'),
        }),
      ],
    })
  if (kind === 'schedule')
    body = html`<form id="builder-entry-schedule">${EntrySchedule(ctx, draft.entry, { command: 'builder.schedule', cancel: 'builder.cancelSchedule', form: 'builder-entry-schedule' })}</form>`
  if (kind === 'media') body = workspace.view('media', sections, { embedded: true })
  // A modal dialog sits above the Studio's toast region and makes it inert: a command run from
  // here (a past schedule time, a conflict) reports inside the dialog instead.
  const notices = h(ToastRegion, { label: tr('website.toast.region'), toasts: ctx.toasts() })
  return html`<dialog id="website-builder-dialog" class="website-confirm-dialog" aria-labelledby="website-builder-sheet-title" on:cancel=${(
    event,
  ) => {
    event.preventDefault()
    close()
  }} on:click=${(event) => {
    if (event.target.closest('[data-ui="modal-close"]')) close()
  }}>${h(ModalSheet, { id: 'website-builder-sheet', title, mode: 'client', presentation: 'dialog', dialogSemantics: 'parent', closeLabel: tr('website.action.close'), body, actions })}${notices}</dialog>`
}
