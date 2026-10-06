import { createRoot, domHost } from '@ketvietlab/ketjs-view'
import type { HostNode } from '@ketvietlab/ketjs-view'
import { LiveImage } from './live-image.tsx'
import { descriptionBlocks, descriptionText } from './rich-description.ts'
import type { LiveDocProps } from '@ketvietlab/ketsuite/livedoc'
import type { LiveImageProps } from './live-image.tsx'

/** What the Studio's mount event hands the element: mount the editor with these props. */
type LiveMountDetail = { mount: (props: LiveDocProps, label: string) => void }
type LiveImageRequest = Parameters<NonNullable<LiveDocProps['onImageRequest']>>

export type LiveDescriptionProps = {
  id: string
  /** A new record has no revision yet (null). */
  revision?: string | null
  /** A record that never had a LiveDoc description keeps null here. */
  value?: string | null
  text?: string
  label: string
  readOnly?: boolean
  /** A form field: the document and its plain text post with the form. */
  field?: boolean
  documentField?: string
  textField?: string
  notify?: boolean
  images?: LiveImageProps
}

export function LiveDescription({
  id,
  revision = '',
  value = '',
  text = '',
  label,
  readOnly = false,
  field = false,
  documentField = 'descriptionDoc',
  textField = 'description',
  notify = false,
  images,
}: LiveDescriptionProps) {
  return (
    <div
      class="website-live-description"
      data-website-livedoc
      data-live-key={`${id}:${revision}:${readOnly}`}
      on:website-live-mount={(event: CustomEvent<LiveMountDetail>) => {
        const root = event.currentTarget as HTMLElement
        event.detail.mount(
          {
            docId: id,
            lang: 'vi',
            local: true,
            readOnly,
            imageDisabled: images?.disabled,
            onImageRequest: images
              ? (...[insert, trigger]: LiveImageRequest) => {
                  root
                    .querySelector('.website-live-image')
                    ?.dispatchEvent(
                      new CustomEvent('website-live-image-open', { detail: { insert, trigger } }),
                    )
                }
              : undefined,
            blocks: descriptionBlocks(value, text),
            onChange: field
              ? (next) => {
                  const doc = root.querySelector<HTMLInputElement>(`[name="${documentField}"]`)!
                  doc.value = JSON.stringify(next.blocks)
                  root.querySelector<HTMLInputElement>(`[name="${textField}"]`)!.value = descriptionText(
                    next.blocks,
                  )
                  if (notify) doc.dispatchEvent(new Event('input', { bubbles: true }))
                }
              : undefined,
          },
          label,
        )
      }}
    >
      {field ? (
        <>
          <input type="hidden" name={documentField} value={value} />
          <input type="hidden" name={textField} value={text} />
        </>
      ) : null}
      {images ? LiveImage(images) : null}
      <div class="website-live-description-editor" />
    </div>
  )
}

export function attachLiveDescriptions(root: HTMLElement, lifetime: AbortSignal) {
  const editors = new Map<HTMLElement, { key: string | undefined; dispose: () => void }>()
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
    const targets = [...root.querySelectorAll<HTMLElement>('[data-website-livedoc]')].filter(
      (el) => !editors.has(el),
    )
    if (!targets.length) return
    const { createLiveDocView } = await import('@ketvietlab/ketsuite/livedoc')
    if (lifetime.aborted || turn !== version) return
    for (const el of targets) {
      if (!root.contains(el) || editors.has(el)) continue
      el.dispatchEvent(
        new CustomEvent<LiveMountDetail>('website-live-mount', {
          detail: {
            mount(props, label) {
              const editor = createLiveDocView(props)
              const target = el.querySelector<HTMLElement>('.website-live-description-editor')!
              const view = createRoot(domHost(), target as unknown as HostNode)
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
              const content = target.querySelector<HTMLElement>('[data-ui="flow-editor-content"]')!
              content.setAttribute('aria-label', label)
              void editor.mountEditor(content)
            },
          },
        }),
      )
    }
  }
}
