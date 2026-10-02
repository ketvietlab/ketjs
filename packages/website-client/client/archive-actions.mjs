import { html } from '@ketvietlab/ketjs-view'
import { Menu, ModalSheet, Button, ActionGroup, Notice, Stack } from '@ketvietlab/design-system'
import { h } from './ui.mjs'

const RETURN_FOCUS = '[data-ui="menu-trigger"], button[name="website-archive-open"]'
const returnFocus = (event) =>
  event.currentTarget.closest('[data-archive-actions]')?.querySelector(RETURN_FOCUS)?.focus()

/**
 * A button that asks before it runs `command` (a `commandValue`). It shares the archive dialog's
 * DOM-local open/cancel handling, so opening never refreshes the screen.
 */
export function ConfirmAction(
  ctx,
  { id, label, title, body, command, variant, confirmVariant, disabled = false },
) {
  return html`<div data-archive-actions>${h(Button, {
    label,
    name: 'website-archive-open',
    value: `${id}-dialog`,
    type: 'button',
    variant,
    disabled,
  })}<dialog id=${`${id}-dialog`} class="website-confirm-dialog" aria-labelledby=${`${id}-sheet-title`} on:close=${returnFocus}>${h(
    ModalSheet,
    {
      id: `${id}-sheet`,
      title,
      mode: 'client',
      presentation: 'dialog',
      dialogSemantics: 'parent',
      closeLabel: ctx.tr('website.action.close'),
      body,
      actions: h(ActionGroup, {
        label,
        actions: [
          h(Button, {
            label: ctx.tr('website.action.cancel'),
            name: 'website-archive-cancel',
            type: 'button',
          }),
          h(Button, {
            label,
            name: 'website-archive-confirm',
            value: command,
            type: 'button',
            variant: confirmVariant ?? variant ?? 'primary',
            disabled,
          }),
        ],
      }),
    },
  )}</dialog></div>`
}

// Opening/cancelling is DOM-local: it must not refresh the screen or discard unsaved form inputs.
export function ArchiveActions(
  ctx,
  { id, title, command, disabled = false, usage = [], restore = false, extraItems = [] },
) {
  const tr = ctx.tr
  const label = tr(restore ? 'website.resource.restore' : 'website.resource.archive')
  return html`<div data-archive-actions>${h(Menu, {
    id: `${id}-more`,
    label: tr('website.resource.more'),
    trigger: '⋯',
    size: 'compact',
    align: 'end',
    items: [
      ...extraItems,
      { id: 'archive', label, name: 'website-archive-open', value: `${id}-dialog`, disabled },
    ],
  })}<dialog id=${`${id}-dialog`} class="website-confirm-dialog" aria-labelledby=${`${id}-sheet-title`} on:close=${returnFocus}>${h(
    ModalSheet,
    {
      id: `${id}-sheet`,
      title: tr(restore ? 'website.resource.restoreTitle' : 'website.resource.archiveTitle', { title }),
      mode: 'client',
      presentation: 'dialog',
      dialogSemantics: 'parent',
      closeLabel: tr('website.action.close'),
      body: h(Stack, {
        items: [
          html`<p>${tr(restore ? 'website.resource.restoreHelp' : 'website.resource.archiveHelp')}</p>`,
          usage.length
            ? h(Notice, {
                title: tr('website.resource.inUse'),
                message: usage.map((r) => r.title).join(', '),
                tone: 'warning',
              })
            : null,
        ].filter(Boolean),
      }),
      actions: h(ActionGroup, {
        label,
        actions: [
          h(Button, { label: tr('website.action.cancel'), name: 'website-archive-cancel', type: 'button' }),
          h(Button, {
            label,
            name: 'website-archive-confirm',
            value: command,
            type: 'button',
            variant: restore ? 'primary' : 'destructive',
            disabled: disabled || !!usage.length,
          }),
        ],
      }),
    },
  )}</dialog></div>`
}

export function handleArchiveClick(event, { run, busy }) {
  const target = event.target
  const opener = target.closest?.('button[name="website-archive-open"]')
  if (opener) {
    event.preventDefault()
    if (opener.disabled || busy()) return true
    const wrapper = opener.closest('[data-archive-actions]')
    const dialog = wrapper.querySelector('dialog')
    wrapper.querySelector('details')?.removeAttribute('open')
    dialog.showModal()
    dialog.querySelector('[name="website-archive-cancel"]')?.focus()
    return true
  }
  const dialog = target.closest?.('.website-confirm-dialog')
  if (!dialog) return false
  const cancel = target.closest(
    '[name="website-archive-cancel"], [data-ui="modal-close"], [data-ui="modal-backdrop"]',
  )
  const confirm = target.closest('[name="website-archive-confirm"]')
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
