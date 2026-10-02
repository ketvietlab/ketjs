import { Menu, ModalSheet, Button, ActionGroup, Notice, Stack } from '@ketvietlab/design-system'
import type { ActionVariant, MenuEntry } from '@ketvietlab/design-system'
import type { StudioContext, View } from './types.ts'

const RETURN_FOCUS = '[data-ui="menu-trigger"], button[name="website-archive-open"]'
const returnFocus = (event: Event) =>
  (event.currentTarget as Element)
    .closest('[data-archive-actions]')
    ?.querySelector<HTMLElement>(RETURN_FOCUS)
    ?.focus()

export type ConfirmActionProps = {
  id: string
  label: string
  title: string
  body: View
  /** A `commandValue`, run with `confirmed=yes` once the dialog is confirmed. */
  command: string
  variant?: ActionVariant
  confirmVariant?: ActionVariant
  disabled?: boolean
}
export type ArchiveActionsProps = {
  id: string
  title: string
  command: string
  disabled?: boolean
  /** Records that still point here; archiving waits until there are none. */
  usage?: { title: string }[]
  restore?: boolean
  extraItems?: MenuEntry[]
}

/**
 * A button that asks before it runs `command` (a `commandValue`). It shares the archive dialog's
 * DOM-local open/cancel handling, so opening never refreshes the screen.
 */
export function ConfirmAction(
  ctx: StudioContext,
  { id, label, title, body, command, variant, confirmVariant, disabled = false }: ConfirmActionProps,
) {
  return (
    <div data-archive-actions>
      <Button
        label={label}
        name="website-archive-open"
        value={`${id}-dialog`}
        type="button"
        variant={variant}
        disabled={disabled}
      />
      <dialog
        id={`${id}-dialog`}
        class="website-confirm-dialog"
        aria-labelledby={`${id}-sheet-title`}
        onClose={returnFocus}
      >
        <ModalSheet
          id={`${id}-sheet`}
          title={title}
          mode="client"
          presentation="dialog"
          dialogSemantics="parent"
          closeLabel={ctx.tr('website.action.close')}
          body={body}
          actions={
            <ActionGroup
              label={label}
              actions={[
                <Button
                  label={ctx.tr('website.action.cancel')}
                  name="website-archive-cancel"
                  type="button"
                />,
                <Button
                  label={label}
                  name="website-archive-confirm"
                  value={command}
                  type="button"
                  variant={confirmVariant ?? variant ?? 'primary'}
                  disabled={disabled}
                />,
              ]}
            />
          }
        />
      </dialog>
    </div>
  )
}

// Opening/cancelling is DOM-local: it must not refresh the screen or discard unsaved form inputs.
export function ArchiveActions(
  ctx: StudioContext,
  { id, title, command, disabled = false, usage = [], restore = false, extraItems = [] }: ArchiveActionsProps,
) {
  const tr = ctx.tr
  const label = tr(restore ? 'website.resource.restore' : 'website.resource.archive')
  return (
    <div data-archive-actions>
      <Menu
        id={`${id}-more`}
        label={tr('website.resource.more')}
        trigger="⋯"
        size="compact"
        align="end"
        items={[
          ...extraItems,
          { id: 'archive', label, name: 'website-archive-open', value: `${id}-dialog`, disabled },
        ]}
      />
      <dialog
        id={`${id}-dialog`}
        class="website-confirm-dialog"
        aria-labelledby={`${id}-sheet-title`}
        onClose={returnFocus}
      >
        <ModalSheet
          id={`${id}-sheet`}
          title={tr(restore ? 'website.resource.restoreTitle' : 'website.resource.archiveTitle', { title })}
          mode="client"
          presentation="dialog"
          dialogSemantics="parent"
          closeLabel={tr('website.action.close')}
          body={
            <Stack
              items={[
                <p>{tr(restore ? 'website.resource.restoreHelp' : 'website.resource.archiveHelp')}</p>,
                usage.length ? (
                  <Notice
                    title={tr('website.resource.inUse')}
                    message={usage.map((r) => r.title).join(', ')}
                    tone="warning"
                  />
                ) : null,
              ].filter(Boolean)}
            />
          }
          actions={
            <ActionGroup
              label={label}
              actions={[
                <Button label={tr('website.action.cancel')} name="website-archive-cancel" type="button" />,
                <Button
                  label={label}
                  name="website-archive-confirm"
                  value={command}
                  type="button"
                  variant={restore ? 'primary' : 'destructive'}
                  disabled={disabled || !!usage.length}
                />,
              ]}
            />
          }
        />
      </dialog>
    </div>
  )
}

export function handleArchiveClick(
  event: Event,
  { run, busy }: { run: (value: string, form?: FormData) => unknown; busy: () => boolean },
): boolean {
  const target = event.target as Element
  const opener = target.closest?.<HTMLButtonElement>('button[name="website-archive-open"]')
  if (opener) {
    event.preventDefault()
    if (opener.disabled || busy()) return true
    const wrapper = opener.closest('[data-archive-actions]')!
    const dialog = wrapper.querySelector('dialog')!
    wrapper.querySelector('details')?.removeAttribute('open')
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[name="website-archive-cancel"]')?.focus()
    return true
  }
  const dialog = target.closest?.<HTMLDialogElement>('.website-confirm-dialog')
  if (!dialog) return false
  const cancel = target.closest(
    '[name="website-archive-cancel"], [data-ui="modal-close"], [data-ui="modal-backdrop"]',
  )
  const confirm = target.closest<HTMLButtonElement>('[name="website-archive-confirm"]')
  if (!cancel && !confirm) return false
  event.preventDefault()
  if (busy() || confirm?.disabled) return true
  dialog.close()
  if (confirm) {
    const form = new FormData()
    form.set('confirmed', 'yes')
    run(confirm.value, form)
  }
  return true
}
