import { ActionGroup, Button, DropZone, Section, Stack, TextField } from '@ketvietlab/design-system'
import type { StudioContext } from './types.ts'
import { safeImage, type GalleryImage } from './renderer.tsx'

const pending = new Set<string>()
export const galleryUploadPending = (entryId: string) => pending.has(entryId)

/** Array editing stays a native form; media uploads belong to the current entry. */
export function GalleryEditor(
  ctx: StudioContext,
  props: {
    entryId: string
    images: GalleryImage[]
    disabled: boolean
    update: (images: GalleryImage[]) => void
  },
) {
  const { tr } = ctx
  props = { ...props, disabled: props.disabled || galleryUploadPending(props.entryId) }
  const rows = props.images.map((item) => ({ ...item }))
  const update = () => props.update(rows)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: delegates native buttons; Enter/Space generate the same click.
    <div
      class="website-gallery-editor"
      onInput={(event: Event) => {
        const input = event.target as HTMLInputElement
        const match = /^gallery-(\d+)-(alt|src|mobileSrc)$/.exec(input.name)
        if (match && !props.disabled) {
          rows[Number(match[1])][match[2] as 'alt' | 'src' | 'mobileSrc'] = input.value
          update()
        }
      }}
      onChange={async (event: Event) => {
        const input = event.target as HTMLInputElement
        const match = /^gallery-(\d+)-(desktop|mobile)-file$/.exec(input.name)
        if (!match || !input.files?.[0] || props.disabled) return
        const file = input.files[0]
        pending.add(props.entryId)
        const form = input.closest('form')!
        form.dataset.uploading = String(Number(form.dataset.uploading || 0) + 1)
        input.disabled = true
        update()
        try {
          const stored = await ctx.uploadImage(file, {
            id: props.entryId,
            field: 'image',
            resModel: 'website.Entry',
            siteId: ctx.site().id,
          })
          rows[Number(match[1])][match[2] === 'mobile' ? 'mobileSrc' : 'src'] = stored.url
        } catch {
          ctx.notify(tr('website.gallery.failed'), 'danger')
        } finally {
          pending.delete(props.entryId)
          update()
          input.disabled = false
          form.dataset.uploading = String(Math.max(0, Number(form.dataset.uploading || 1) - 1))
        }
      }}
      onClick={(event: Event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>('button[name="gallery-action"]')
        if (!button || props.disabled) return
        const [action, raw] = button.value.split(':')
        const index = Number(raw)
        if (action === 'add' && rows.length < 200) rows.push({ src: '', alt: '' })
        if (action === 'remove') rows.splice(index, 1)
        if (action === 'up' && index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]]
        update()
      }}
    >
      <input type="hidden" name="images" value={JSON.stringify(rows)} />
      <Stack
        items={[
          ...rows.map((item, index) => (
            <Section
              title={`${index + 1}`}
              body={
                <Stack
                  items={[
                    <DropZone
                      id={`gallery-${index}-desktop-file`}
                      name={`gallery-${index}-desktop-file`}
                      label={tr('website.taxonomy.uploadImage')}
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      disabled={props.disabled}
                      preview={item.src ? { src: safeImage(item.src), alt: item.alt || '' } : null}
                    />,
                    <TextField
                      id={`gallery-${index}-src`}
                      name={`gallery-${index}-src`}
                      label={tr('website.builder.setting.image')}
                      value={item.src}
                      disabled={props.disabled}
                    />,
                    <TextField
                      id={`gallery-${index}-alt`}
                      name={`gallery-${index}-alt`}
                      label={tr('website.gallery.alt')}
                      value={item.alt || ''}
                      disabled={props.disabled}
                    />,
                    <DropZone
                      id={`gallery-${index}-mobile-file`}
                      name={`gallery-${index}-mobile-file`}
                      label={tr('website.gallery.mobile')}
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      disabled={props.disabled}
                      preview={
                        item.mobileSrc ? { src: safeImage(item.mobileSrc), alt: item.alt || '' } : null
                      }
                    />,
                    <TextField
                      id={`gallery-${index}-mobileSrc`}
                      name={`gallery-${index}-mobileSrc`}
                      label={tr('website.gallery.mobile')}
                      value={item.mobileSrc || ''}
                      disabled={props.disabled}
                    />,
                    <ActionGroup
                      label={tr('website.builder.arrange')}
                      actions={[
                        <Button
                          name="gallery-action"
                          value={`up:${index}`}
                          label={tr('website.gallery.up')}
                          disabled={props.disabled || index === 0}
                        />,
                        <Button
                          name="gallery-action"
                          value={`remove:${index}`}
                          label={tr('website.gallery.remove')}
                          variant="destructive"
                          disabled={props.disabled}
                        />,
                      ]}
                    />,
                  ]}
                />
              }
            />
          )),
          <Button
            name="gallery-action"
            value="add"
            label={tr('website.gallery.add')}
            disabled={props.disabled || rows.length >= 200}
          />,
        ]}
      />
    </div>
  )
}
