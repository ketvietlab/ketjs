import { Button, ModalSheet, Stack } from '@ketvietlab/design-system'
import { AttachmentImage } from './image-upload.tsx'
import type { LiveDocProps } from '@ketvietlab/ketsuite/livedoc'
import type { StudioContext } from './types.ts'

type InsertImage = Parameters<NonNullable<LiveDocProps['onImageRequest']>>[0]
export type LiveImageProps = { ctx: StudioContext; ownerId: string; disabled?: boolean }

export function LiveImage({ ctx, ownerId, disabled }: LiveImageProps) {
  const tr = ctx.tr
  let opener: HTMLElement | undefined, insertImage: InsertImage | null | undefined
  const close = (dialog: HTMLDialogElement) => {
    dialog.close()
    opener?.focus()
  }
  return (
    <div
      class="website-live-image"
      on:website-live-image-open={(event: CustomEvent<{ insert: InsertImage; trigger: HTMLElement }>) => {
        if (disabled || !ctx.can('website.content.write')) return
        opener = event.detail.trigger
        insertImage = event.detail.insert
        ;(event.currentTarget as HTMLElement).querySelector('dialog')!.showModal()
      }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Delegates clicks from the close button; the native dialog closes on Escape. */}
      <dialog
        onClick={(event) => {
          if ((event.target as Element).closest('[data-ui="modal-close"]'))
            close(event.currentTarget as HTMLDialogElement)
        }}
        class="website-confirm-dialog"
        aria-labelledby={`live-image-${ownerId}-title`}
        onCancel={(event: Event) => {
          event.preventDefault()
          close(event.currentTarget as HTMLDialogElement)
        }}
      >
        <ModalSheet
          id={`live-image-${ownerId}`}
          title={tr('website.liveImage.insert')}
          mode="client"
          presentation="dialog"
          dialogSemantics="parent"
          closeLabel={tr('website.action.cancel')}
          body={
            <Stack
              items={[
                AttachmentImage(ctx, { id: ownerId, field: 'image', resModel: 'website.Entry', disabled }),
                <p role="alert" data-live-image-error />,
              ]}
            />
          }
          actions={
            <>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: Delegates clicks from native buttons, which already handle Enter and Space. */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: Delegates clicks from native buttons, which already handle Enter and Space. */}
              <span onClick={(event) => close((event.currentTarget as Element).closest('dialog')!)}>
                <Button label={tr('website.action.cancel')} type="button" />
              </span>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: Delegates clicks from native buttons, which already handle Enter and Space. */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: Delegates clicks from native buttons, which already handle Enter and Space. */}
              <span
                onClick={(event) => {
                  if (disabled || !ctx.can('website.content.write')) return
                  const dialog = (event.currentTarget as Element).closest('dialog')!
                  const error = dialog.querySelector('[data-live-image-error]')!
                  const src = dialog.querySelector<HTMLInputElement>('[name="image"]')!.value
                  if (!src || dialog.querySelector('[data-uploading="true"]')) {
                    error.textContent = tr('website.liveImage.wait')
                    return
                  }
                  const ok = insertImage?.({
                    src,
                    alt: dialog.querySelector<HTMLInputElement>('[name="imageAlt"]')!.value,
                  })
                  if (!ok) {
                    error.textContent = tr('website.liveImage.unavailable')
                    return
                  }
                  insertImage = null
                  error.textContent = ''
                  close(dialog)
                }}
              >
                <Button
                  label={tr('website.liveImage.insert')}
                  variant="primary"
                  type="button"
                  disabled={disabled}
                />
              </span>
            </>
          }
        />
      </dialog>
    </div>
  )
}
