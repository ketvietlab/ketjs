import { DropZone, Button, Stack, TextField } from '@ketvietlab/design-system'
import { safeImage } from './renderer.tsx'
import type { ImageOwner, ImageUploadOptions, StudioContext } from './types.ts'

export const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/avif'
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export function validateImage(file: File | null | undefined): file is File {
  return !!file && IMAGE_TYPES.split(',').includes(file.type) && file.size > 0 && file.size <= IMAGE_MAX_BYTES
}
export async function uploadImage(
  file: File,
  {
    siteId,
    id,
    field,
    resModel = 'website.TaxonomyTerm',
    signal,
    headers = {},
    endpoint = '/files',
  }: ImageUploadOptions & { endpoint?: string },
): Promise<{ id: string; url: string }> {
  const body = new FormData()
  body.append('file', file, file.name)
  body.append('resModel', resModel)
  body.append('resId', id)
  body.append('resField', field)
  body.append('siteId', siteId)
  body.append('public', 'true')
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    body,
    headers,
    signal,
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || typeof result?.id !== 'string') throw new Error('upload')
  return { id: result.id, url: result.url || `/files/${encodeURIComponent(result.id)}` }
}

// Upload changes an attachment reference, never the taxonomy record itself. Save commits the reference.
export async function acceptImageFiles(
  root: HTMLElement,
  files: File[],
  ctx: StudioContext,
  owner: ImageOwner,
) {
  if (!files.length || root.dataset.uploading === 'true' || !ctx.can('website.content.write')) return
  const status = root.querySelector('[data-image-status]')!
  status.setAttribute('role', 'status')
  if (files.length !== 1 || !validateImage(files[0])) {
    status.setAttribute('role', 'alert')
    status.textContent = ctx.tr('website.taxonomy.imageInvalid')
    return
  }
  const form = root.closest('form')!
  root.dataset.uploading = 'true'
  form.dataset.uploading = String(Number(form.dataset.uploading || 0) + 1)
  status.textContent = ctx.tr('website.taxonomy.imageUploading')
  const controls = [
    ...root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input[type="file"],button'),
  ]
  controls.forEach((control) => {
    control.disabled = true
  })
  try {
    const stored = await ctx.uploadImage(files[0], { ...owner, siteId: ctx.site().id })
    if (!root.isConnected) return
    const input = root.querySelector<HTMLInputElement>('input[type="hidden"]')!
    input.value = stored.url
    const image = root.querySelector('img')!
    image.src = safeImage(stored.url)
    image.hidden = false
    status.textContent = ctx.tr('website.taxonomy.imageUploaded')
  } catch {
    if (root.isConnected) {
      status.setAttribute('role', 'alert')
      status.textContent = ctx.tr('website.taxonomy.imageFailed')
    }
  } finally {
    root.dataset.uploading = 'false'
    form.dataset.uploading = String(Math.max(0, Number(form.dataset.uploading || 1) - 1))
    controls.forEach((control) => {
      control.disabled = false
    })
    root.querySelector<HTMLInputElement>('input[type="file"]')!.value = ''
  }
}
/** `describe: false` drops the alt text field, for an image whose owner already names it - a site logo. */
export type TaxonomyImageProps = ImageOwner & {
  value?: string
  alt?: string
  disabled?: boolean
  describe?: boolean
}

export function TaxonomyImage(
  ctx: StudioContext,
  {
    id,
    field,
    value = '',
    alt = '',
    disabled = false,
    resModel = 'website.TaxonomyTerm',
    describe = true,
  }: TaxonomyImageProps,
) {
  const receive = (root: HTMLElement, files: FileList | readonly File[]) =>
    void acceptImageFiles(root, [...files], ctx, { id, field, resModel })
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for dragged files; the file button inside is the keyboard path.
    <div
      class="website-taxonomy-image"
      onDragOver={(event: DragEvent) => {
        if (disabled) return
        event.preventDefault()
        event.dataTransfer!.dropEffect = 'copy'
      }}
      onDrop={(event: DragEvent) => {
        event.preventDefault()
        if (!disabled) receive(event.currentTarget as HTMLElement, event.dataTransfer?.files ?? [])
      }}
      onChange={(event) => {
        const root = event.currentTarget as HTMLElement
        const input = event.target as HTMLInputElement
        if (input.type === 'file' && !disabled) receive(root, input.files ?? [])
        if (input.name === field + 'Alt') root.querySelector('img')!.alt = input.value
      }}
    >
      <Stack
        items={[
          <>
            <input type="hidden" name={field} value={value} />
            <img
              class={`website-attachment-preview website-taxonomy-image-${field}`}
              src={value ? safeImage(value) : null}
              alt={alt}
              hidden={!value}
            />
          </>,
          <DropZone
            id={`${id}-${field}-file`}
            name={`${field}File`}
            label={ctx.tr('website.taxonomy.uploadImage')}
            accept={IMAGE_TYPES}
            disabled={disabled}
            span="full"
            status={
              <span data-image-status role="status">
                {ctx.tr('website.taxonomy.dropImage')}
              </span>
            }
          />,
          // biome-ignore lint/a11y/noStaticElementInteractions: Delegates clicks from native buttons, which already handle Enter and Space.
          // biome-ignore lint/a11y/useKeyWithClickEvents: Delegates clicks from native buttons, which already handle Enter and Space.
          <span
            onClick={(event) => {
              if (disabled || !(event.target as Element).closest('button')) return
              const root = (event.currentTarget as Element).closest('.website-taxonomy-image')!
              root.querySelector<HTMLInputElement>('input[type="hidden"]')!.value = ''
              const image = root.querySelector('img')!
              image.hidden = true
              image.removeAttribute('src')
              root.querySelector('[data-image-status]')!.textContent = ctx.tr('website.taxonomy.dropImage')
            }}
          >
            <Button
              label={ctx.tr('website.taxonomy.removeImage')}
              type="button"
              variant="tertiary"
              disabled={disabled}
            />
          </span>,
          describe ? (
            <TextField
              id={`${id}-${field}-alt`}
              name={`${field}Alt`}
              label={ctx.tr('website.taxonomy.imageAlt')}
              value={alt}
              disabled={disabled}
            />
          ) : null,
        ]}
      />
    </div>
  )
}

export const AttachmentImage = TaxonomyImage
