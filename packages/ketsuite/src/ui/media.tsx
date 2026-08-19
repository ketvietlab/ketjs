import { each } from 'ketjs-view'
import type { JSXChild, TemplateResult } from 'ketjs-view'
import { button } from './actions.tsx'
import { errorState, loadingState } from './state.tsx'

export const HOOKS = [
  'media',
  'media-primary',
  'media-placeholder',
  'media-gallery',
  'media-item',
  'media-actions',
  'media-upload',
  'media-file-label',
  'media-file-input',
  'media-item-actions',
  'media-extension',
] as const

export type MediaItem = {
  id: string
  src: string
  alt: string
  primary?: boolean
  actions?: {
    primary?: string
    remove?: string
    moveUp?: string
    moveDown?: string
  }
}

export type MediaLabels = {
  unavailable: string
  empty: string
  loading: string
  loadError: string
  retryHint: string
  makePrimary: string
  moveUp: string
  moveDown: string
  remove: string
  choose: string
  add: string
}

/**
 * Storage-neutral image gallery. Domain bridges provide URLs and native form
 * endpoints; the component never assumes a schema, object store or upload API.
 */
export type MediaPanelProps = {
  status: 'unavailable' | 'loading' | 'ready' | 'error'
  images?: readonly MediaItem[]
  error?: string | null
  extension?: JSXChild
  uploadAction?: string | null
  labels?: Partial<MediaLabels>
}

const defaultLabels: MediaLabels = {
  unavailable: 'Image service is not connected.',
  empty: 'No images yet.',
  loading: 'Loading images',
  loadError: 'Images could not be loaded',
  retryHint: 'Try again when the image service is available.',
  makePrimary: 'Set as primary',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove image',
  choose: 'Choose image',
  add: 'Add image',
}

export const mediaPanel = (props: MediaPanelProps): TemplateResult => {
  const images = props.images ?? []
  const primary = images.find((image) => image.primary) ?? images[0]
  const labels = { ...defaultLabels, ...props.labels }
  return (
    <section data-ui="media" data-state={props.status}>
      {props.status === 'loading' ? (
        loadingState(labels.loading, 2)
      ) : props.status === 'error' ? (
        errorState('E_PRODUCT_MEDIA', props.error ?? labels.loadError, labels.retryHint)
      ) : primary ? (
        <img data-ui="media-primary" src={primary.src} alt={primary.alt} />
      ) : (
        <div data-ui="media-placeholder" role="status">
          {props.status === 'unavailable' ? labels.unavailable : labels.empty}
        </div>
      )}
      {props.status === 'ready' && images.length > 0 && (
        <div data-ui="media-gallery">
          {each(
            images,
            (image) => image.id,
            (image) => (
              <article data-ui="media-item">
                <img src={image.src} alt={image.alt} />
                {image.actions && (
                  <div data-ui="media-item-actions">
                    {image.actions.primary && !image.primary && (
                      <form method="post" action={image.actions.primary}>
                        {button({ label: labels.makePrimary, type: 'submit' })}
                      </form>
                    )}
                    {image.actions.moveUp && (
                      <form method="post" action={image.actions.moveUp}>
                        {button({ label: labels.moveUp, type: 'submit' })}
                      </form>
                    )}
                    {image.actions.moveDown && (
                      <form method="post" action={image.actions.moveDown}>
                        {button({ label: labels.moveDown, type: 'submit' })}
                      </form>
                    )}
                    {image.actions.remove && (
                      <form method="post" action={image.actions.remove}>
                        {button({ label: labels.remove, type: 'submit', variant: 'destructive' })}
                      </form>
                    )}
                  </div>
                )}
              </article>
            ),
          )}
        </div>
      )}
      <div data-ui="media-actions">
        {props.uploadAction ? (
          <form
            data-ui="media-upload"
            method="post"
            action={props.uploadAction}
            enctype="multipart/form-data"
          >
            <label data-ui="media-file-label">
              <span>{labels.choose}</span>
              <input data-ui="media-file-input" type="file" name="file" accept="image/*" required />
            </label>
            {button({ label: labels.add, type: 'submit', disabled: props.status === 'unavailable' })}
          </form>
        ) : (
          button({ label: labels.add, disabled: true })
        )}
      </div>
      {props.extension !== undefined && <div data-ui="media-extension">{props.extension}</div>}
    </section>
  )
}
