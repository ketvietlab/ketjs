import { html } from '@ketvietlab/ketjs-view'
import { Button, ModalSheet, Stack } from '@ketvietlab/design-system'
import { AttachmentImage } from './image-upload.mjs'
import { h } from './ui.mjs'

export function LiveImage({ ctx, ownerId, disabled }) {
  const tr = ctx.tr
  let opener, insertImage
  const close = (dialog) => {
    dialog.close()
    opener?.focus()
  }
  return html`<div class="website-live-image" on:website-live-image-open=${(event) => {
    if (disabled || !ctx.can('website.content.write')) return
    opener = event.detail.trigger
    insertImage = event.detail.insert
    event.currentTarget.querySelector('dialog').showModal()
  }}>
    <dialog on:click=${(event) => {
      if (event.target.closest('[data-ui="modal-close"]')) close(event.currentTarget)
    }} class="website-confirm-dialog" aria-labelledby=${`live-image-${ownerId}-title`} on:cancel=${(
      event,
    ) => {
      event.preventDefault()
      close(event.currentTarget)
    }}>
      ${h(ModalSheet, {
        id: `live-image-${ownerId}`,
        title: tr('website.liveImage.insert'),
        mode: 'client',
        presentation: 'dialog',
        dialogSemantics: 'parent',
        closeLabel: tr('website.action.cancel'),
        body: h(Stack, {
          items: [
            AttachmentImage(ctx, { id: ownerId, field: 'image', resModel: 'website.Entry', disabled }),
            html`<p role="alert" data-live-image-error></p>`,
          ],
        }),
        actions: html`<span on:click=${(event) => close(event.currentTarget.closest('dialog'))}>${h(Button, { label: tr('website.action.cancel'), type: 'button' })}</span>
          <span on:click=${(event) => {
            if (disabled || !ctx.can('website.content.write')) return
            const dialog = event.currentTarget.closest('dialog')
            const error = dialog.querySelector('[data-live-image-error]')
            const src = dialog.querySelector('[name="image"]').value
            if (!src || dialog.querySelector('[data-uploading="true"]')) {
              error.textContent = tr('website.liveImage.wait')
              return
            }
            const ok = insertImage?.({ src, alt: dialog.querySelector('[name="imageAlt"]').value })
            if (!ok) {
              error.textContent = tr('website.liveImage.unavailable')
              return
            }
            insertImage = null
            error.textContent = ''
            close(dialog)
          }}>${h(Button, { label: tr('website.liveImage.insert'), variant: 'primary', type: 'button', disabled })}</span>`,
      })}
    </dialog>
  </div>`
}
