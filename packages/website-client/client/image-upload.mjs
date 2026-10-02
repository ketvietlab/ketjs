import { html } from '@ketvietlab/ketjs-view'
import { DropZone, Button, Stack, TextField } from '@ketvietlab/design-system'
import { h } from './ui.mjs'
import { safeImage } from './renderer.mjs'

export const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/avif'
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export function validateImage(file) {
  return !!file && IMAGE_TYPES.split(',').includes(file.type) && file.size > 0 && file.size <= IMAGE_MAX_BYTES
}
export async function uploadImage(
  file,
  { siteId, id, field, resModel = 'website.TaxonomyTerm', signal, headers = {}, endpoint = '/files' },
) {
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
export async function acceptImageFiles(root, files, ctx, owner) {
  if (!files.length || root.dataset.uploading === 'true' || !ctx.can('website.content.write')) return
  const status = root.querySelector('[data-image-status]')
  status.setAttribute('role', 'status')
  if (files.length !== 1 || !validateImage(files[0])) {
    status.setAttribute('role', 'alert')
    status.textContent = ctx.tr('website.taxonomy.imageInvalid')
    return
  }
  const form = root.closest('form')
  root.dataset.uploading = 'true'
  form.dataset.uploading = String(Number(form.dataset.uploading || 0) + 1)
  status.textContent = ctx.tr('website.taxonomy.imageUploading')
  const controls = [...root.querySelectorAll('input[type="file"],button')]
  controls.forEach((control) => {
    control.disabled = true
  })
  try {
    const stored = await ctx.uploadImage(files[0], { ...owner, siteId: ctx.site().id })
    if (!root.isConnected) return
    const input = root.querySelector('input[type="hidden"]')
    input.value = stored.url
    const image = root.querySelector('img')
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
    root.querySelector('input[type="file"]').value = ''
  }
}
export function TaxonomyImage(
  ctx,
  { id, field, value = '', alt = '', disabled = false, resModel = 'website.TaxonomyTerm' },
) {
  const receive = (root, files) => void acceptImageFiles(root, [...files], ctx, { id, field, resModel })
  return html`<div class="website-taxonomy-image" on:dragover=${(event) => {
    if (disabled) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }} on:drop=${(event) => {
    event.preventDefault()
    if (!disabled) receive(event.currentTarget, event.dataTransfer?.files ?? [])
  }} on:change=${(event) => {
    const root = event.currentTarget
    if (event.target.type === 'file' && !disabled) receive(root, event.target.files ?? [])
    if (event.target.name === field + 'Alt') root.querySelector('img').alt = event.target.value
  }}>${h(Stack, {
    items: [
      html`<input type="hidden" name=${field} value=${value} /><img class=${`website-attachment-preview website-taxonomy-image-${field}`} src=${value ? safeImage(value) : null} alt=${alt} hidden=${!value} />`,
      h(DropZone, {
        id: `${id}-${field}-file`,
        name: `${field}File`,
        label: ctx.tr('website.taxonomy.uploadImage'),
        accept: IMAGE_TYPES,
        disabled,
        span: 'full',
        status: html`<span data-image-status role="status">${ctx.tr('website.taxonomy.dropImage')}</span>`,
      }),
      html`<span on:click=${(event) => {
        if (disabled || !event.target.closest('button')) return
        const root = event.currentTarget.closest('.website-taxonomy-image')
        root.querySelector('input[type="hidden"]').value = ''
        const image = root.querySelector('img')
        image.hidden = true
        image.removeAttribute('src')
        root.querySelector('[data-image-status]').textContent = ctx.tr('website.taxonomy.dropImage')
      }}>${h(Button, { label: ctx.tr('website.taxonomy.removeImage'), type: 'button', variant: 'tertiary', disabled })}</span>`,
      h(TextField, {
        id: `${id}-${field}-alt`,
        name: `${field}Alt`,
        label: ctx.tr('website.taxonomy.imageAlt'),
        value: alt,
        disabled,
      }),
    ],
  })}</div>`
}

export const AttachmentImage = TaxonomyImage
