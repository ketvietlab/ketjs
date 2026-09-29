import { tr, flowLocaleTag } from './i18n.mjs'
import { html, each } from '@ketvietlab/ketjs-view'
import { FlowButton, FlowIcon } from './index.mjs'
/** @param {number} bytes */
const fileSize = (bytes) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.ceil(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toLocaleString(flowLocaleTag(), { maximumFractionDigits: 1 })} MB`
/** Controlled file selection. Consumers own files, validation and persistence.
 * @param {{id:string,files:File[],disabled?:boolean,onChange:(files:File[])=>void}} p */
export function FlowFileDropzone(p) {
  /** @param {File[]} incoming */
  const add = (incoming) => {
    if (p.disabled) return
    const files = [...p.files]
    for (const file of incoming)
      if (
        !files.some(
          (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified,
        )
      )
        files.push(file)
    p.onChange(files)
  }
  return html`<div data-flow="file-picker">
    <label data-flow="file-dropzone" data-disabled=${p.disabled ? 'true' : null} for=${p.id}
      on:dragover=${
        /** @param {DragEvent} e */ (e) => {
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = p.disabled ? 'none' : 'copy'
          if (!p.disabled) /** @type {HTMLElement} */ (e.currentTarget).dataset.dragging = 'true'
        }
      }
      on:dragleave=${
        /** @param {DragEvent} e */ (e) => {
          const zone = /** @type {HTMLElement} */ (e.currentTarget)
          if (!e.relatedTarget || !zone.contains(/** @type {Node} */ (e.relatedTarget)))
            delete zone.dataset.dragging
        }
      }
      on:drop=${
        /** @param {DragEvent} e */ (e) => {
          e.preventDefault()
          e.stopPropagation()
          delete (/** @type {HTMLElement} */ (e.currentTarget).dataset.dragging)
          add(Array.from(e.dataTransfer?.files ?? []))
        }
      }>
      <input id=${p.id} type="file" multiple disabled=${p.disabled ?? false} aria-label=${tr('flow.ui.select.attachments')} aria-describedby=${`${p.id}-hint`}
        on:change=${
          /** @param {Event} e */ (e) => {
            const input = /** @type {HTMLInputElement} */ (e.currentTarget)
            const files = Array.from(input.files ?? [])
            input.value = ''
            add(files)
          }
        } />
      ${FlowIcon('inbox')}<strong>${tr('flow.ui.drop.files.here')}</strong>
      <span>${tr('flow.ui.or')}<span data-flow="file-browse">${tr('flow.ui.choose.files')}</span></span>
      <small id=${`${p.id}-hint`}>${tr('flow.ui.you.can.select.multiple.files')}</small>
    </label>
    ${
      p.files.length
        ? html`<div data-flow="file-selection"><p role="status">${tr('flow.ui.files.selected', [p.files.length, fileSize(p.files.reduce((sum, f) => sum + f.size, 0))])}</p><ul aria-label=${tr('flow.ui.selected.files')}>${each(
            p.files,
            (_, i) => i,
            (file, i) =>
              html`<li>${FlowIcon('file')}<div><span title=${file.name}>${file.name}</span><small>${fileSize(file.size)}</small></div>${FlowButton({ label: tr('flow.ui.remove.file', [file.name]), icon: 'close', iconOnly: true, variant: 'ghost', size: 'sm', disabled: p.disabled, onClick: () => p.onChange(p.files.filter((_, index) => index !== i)) })}</li>`,
          )}</ul></div>`
        : null
    }
  </div>`
}
/** Immediate drop target for an existing record: dropped or chosen files go straight to `onFiles`.
 * `children` (e.g. the files already attached) share the drop area. `pending` lists files that are
 * saving or failed to save; `onRetry`/`onDiscard` render when the consumer is idle.
 * @param {{id:string,disabled?:boolean,busy?:boolean,hint?:string,pending?:File[],onFiles:(files:File[])=>void,onRetry?:()=>void,onDiscard?:()=>void,children?:import('@ketvietlab/ketjs-view').Renderable}} p */
export function FlowFileDrop(p) {
  const off = p.disabled || p.busy
  /** @param {File[]} files */
  const add = (files) => {
    if (!off && files.length) p.onFiles(files)
  }
  const pending = p.pending ?? []
  return html`<div data-flow="file-drop" data-disabled=${off ? 'true' : null}
    on:dragover=${
      /** @param {DragEvent} e */ (e) => {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = off ? 'none' : 'copy'
        if (!off) /** @type {HTMLElement} */ (e.currentTarget).dataset.dragging = 'true'
      }
    }
    on:dragleave=${
      /** @param {DragEvent} e */ (e) => {
        const zone = /** @type {HTMLElement} */ (e.currentTarget)
        if (!e.relatedTarget || !zone.contains(/** @type {Node} */ (e.relatedTarget)))
          delete zone.dataset.dragging
      }
    }
    on:drop=${
      /** @param {DragEvent} e */ (e) => {
        e.preventDefault()
        e.stopPropagation()
        delete (/** @type {HTMLElement} */ (e.currentTarget).dataset.dragging)
        add(Array.from(e.dataTransfer?.files ?? []))
      }
    }>
    ${p.children ?? null}
    ${pending.length ? html`<div data-flow="file-drop-pending" role="status"><span>${p.busy ? tr('flow.ui.adding.files', [pending.length]) : tr('flow.ui.files.not.added', [pending.length])}</span>${!p.busy && p.onRetry ? FlowButton({ label: tr('flow.ui.retry.files'), size: 'sm', disabled: p.disabled, onClick: p.onRetry }) : null}${!p.busy && p.onDiscard ? FlowButton({ label: tr('flow.ui.discard.files'), size: 'sm', variant: 'ghost', onClick: p.onDiscard }) : null}</div>` : null}
    <label data-flow="file-drop-zone" for=${p.id}>
      <input id=${p.id} type="file" multiple disabled=${off ?? false} aria-label=${tr('flow.ui.select.attachments')} aria-describedby=${p.hint ? `${p.id}-hint` : null}
        on:change=${
          /** @param {Event} e */ (e) => {
            const input = /** @type {HTMLInputElement} */ (e.currentTarget)
            const files = Array.from(input.files ?? [])
            input.value = ''
            add(files)
          }
        } />
      ${FlowIcon('inbox')}<span><strong>${tr('flow.ui.drop.files.here')}</strong> ${tr('flow.ui.or')}<span data-flow="file-browse">${tr('flow.ui.choose.files')}</span></span>
      ${p.hint ? html`<small id=${`${p.id}-hint`}>${p.hint}</small>` : null}
    </label>
  </div>`
}
// Only raster images and common video containers render inline; everything else (SVG, HTML, PDF…) downloads.
const previewTypes = {
  image: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/ogg'],
}
/** @param {string|undefined|null} type @returns {'image'|'video'|'file'} */
export const attachmentKind = (type) =>
  previewTypes.image.includes(type ?? '')
    ? 'image'
    : previewTypes.video.includes(type ?? '')
      ? 'video'
      : 'file'
/** One attached file. With `url`, images/videos open `onPreview` and every file can be downloaded.
 * Without `url` the row explains that no content is stored.
 * @param {{title:string,meta?:string,type?:string|null,url?:string|null,onPreview?:()=>void}} p */
export function FlowAttachment(p) {
  const kind = attachmentKind(p.type),
    preview = p.url && kind !== 'file' && p.onPreview
  const thumb =
    kind === 'image' && p.url
      ? html`<img src=${p.url} alt="" loading="lazy" decoding="async" />`
      : FlowIcon(kind === 'video' ? 'play' : kind === 'image' ? 'image' : 'file')
  return html`<div data-flow="attachment" data-kind=${kind}>
    ${preview ? html`<button type="button" data-flow="attachment-thumb" aria-label=${tr('flow.ui.preview.file', [p.title])} on:click=${p.onPreview}>${thumb}</button>` : html`<span data-flow="attachment-thumb" aria-hidden="true">${thumb}</span>`}
    <div data-flow="attachment-text">${preview ? html`<button type="button" data-flow="attachment-title" title=${p.title} on:click=${p.onPreview}>${p.title}</button>` : html`<strong data-flow="attachment-title" title=${p.title}>${p.title}</strong>`}<small>${p.url ? (p.meta ?? '') : [p.meta, tr('flow.ui.no.stored.content')].filter(Boolean).join(' · ')}</small></div>
    ${p.url ? html`<a data-flow="button" data-variant="ghost" data-size="sm" href=${p.url + (p.url.includes('?') ? '&' : '?') + 'download=1'} download=${p.title} aria-label=${tr('flow.ui.download.file', [p.title])} title=${tr('flow.ui.download')}>${FlowIcon('download')}</a>` : null}
  </div>`
}
/** Dialog body for an image or video attachment. @param {{title:string,type?:string|null,url:string}} p */
export const FlowMediaPreview = (p) =>
  attachmentKind(p.type) === 'video'
    ? html`<div data-flow="media-preview"><video src=${p.url} controls preload="metadata" playsinline></video></div>`
    : html`<div data-flow="media-preview"><img src=${p.url} alt=${p.title} /></div>`
