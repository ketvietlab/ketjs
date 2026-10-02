import { html, createRoot, domHost } from '@ketvietlab/ketjs-view'
import { LiveImage } from './live-image.mjs'
import { descriptionBlocks, descriptionText } from './rich-description.mjs'

export function LiveDescription({
  id,
  revision = '',
  value = '',
  text = '',
  label,
  readOnly = false,
  field = false,
  images,
}) {
  return html`<div class="website-live-description" data-website-livedoc data-live-key=${`${id}:${revision}:${readOnly}`}
    on:website-live-mount=${(event) => {
      const root = event.currentTarget
      event.detail.mount(
        {
          docId: id,
          lang: 'vi',
          local: true,
          readOnly,
          imageDisabled: images?.disabled,
          onImageRequest: images
            ? (insert, trigger) => {
                root
                  .querySelector('.website-live-image')
                  ?.dispatchEvent(new CustomEvent('website-live-image-open', { detail: { insert, trigger } }))
              }
            : undefined,
          blocks: descriptionBlocks(value, text),
          onChange: field
            ? (next) => {
                root.querySelector('[name="descriptionDoc"]').value = JSON.stringify(next.blocks)
                root.querySelector('[name="description"]').value = descriptionText(next.blocks)
              }
            : undefined,
        },
        label,
      )
    }}>
    ${field ? html`<input type="hidden" name="descriptionDoc" value=${value} /><input type="hidden" name="description" value=${text} />` : null}
    ${images ? LiveImage(images) : null}
    <div class="website-live-description-editor"></div>
  </div>`
}

export function attachLiveDescriptions(root, lifetime) {
  const editors = new Map()
  let version = 0
  const dispose = () => {
    version++
    for (const entry of editors.values()) entry.dispose()
    editors.clear()
  }
  lifetime.addEventListener('abort', dispose, { once: true })
  return async function sync() {
    const turn = ++version
    for (const [el, entry] of editors)
      if (!root.contains(el) || el.dataset.liveKey !== entry.key) {
        entry.dispose()
        editors.delete(el)
      }
    const targets = [...root.querySelectorAll('[data-website-livedoc]')].filter((el) => !editors.has(el))
    if (!targets.length) return
    const { createLiveDocView } = await import('@ketvietlab/ketsuite/livedoc')
    if (lifetime.aborted || turn !== version) return
    for (const el of targets) {
      if (!root.contains(el) || editors.has(el)) continue
      el.dispatchEvent(
        new CustomEvent('website-live-mount', {
          detail: {
            mount(props, label) {
              const editor = createLiveDocView(props)
              const target = el.querySelector('.website-live-description-editor')
              const view = createRoot(domHost(), target)
              editors.set(el, {
                key: el.dataset.liveKey,
                // The element outlives its editor when only its key changes (the first save
                // gives a new term a revision), so the old editor's nodes go with it; left in
                // place, the next mount drew a second editor under the first.
                dispose() {
                  editor.dispose()
                  view.dispose({ remove: true })
                },
              })
              view.render(editor.view())
              const content = target.querySelector('[data-ui="flow-editor-content"]')
              content.setAttribute('aria-label', label)
              void editor.mountEditor(content)
            },
          },
        }),
      )
    }
  }
}
