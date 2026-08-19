import { each } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import { button } from './actions.tsx'
import { errorState, loadingState } from './state.tsx'

export const HOOKS = [
  'media',
  'media-primary',
  'media-placeholder',
  'media-gallery',
  'media-item',
  'media-actions',
  'media-extension',
] as const

export type MediaItem = {
  id: string
  src: string
  alt: string
  primary?: boolean
}

/**
 * UI-only port for a future image adapter. It owns no URL, upload, persistence or processing.
 * An integration may supply state and controls later; unavailable performs no network request.
 */
export type MediaPanelProps = {
  status: 'unavailable' | 'loading' | 'ready' | 'error'
  images?: readonly MediaItem[]
  error?: string | null
  extension?: unknown
}

export const mediaPanel = (props: MediaPanelProps): TemplateResult => {
  const images = props.images ?? []
  const primary = images.find((image) => image.primary) ?? images[0]
  return (
    <section data-ui="media" data-state={props.status}>
      {props.status === 'loading' ? (
        loadingState('Đang tải hình ảnh', 2)
      ) : props.status === 'error' ? (
        errorState(
          'E_PRODUCT_MEDIA',
          props.error ?? 'Không thể tải hình ảnh',
          'Thử lại khi adapter hình ảnh sẵn sàng.',
        )
      ) : primary ? (
        <img data-ui="media-primary" src={primary.src} alt={primary.alt} />
      ) : (
        <div data-ui="media-placeholder" role="status">
          Hình ảnh sẽ khả dụng sau khi kết nối dịch vụ media.
        </div>
      )}
      {props.status === 'ready' && images.length > 1 && (
        <div data-ui="media-gallery">
          {each(
            images,
            (image) => image.id,
            (image) => (
              <img data-ui="media-item" src={image.src} alt={image.alt} />
            ),
          )}
        </div>
      )}
      <div data-ui="media-actions">
        {button({ label: 'Thêm ảnh', disabled: props.status === 'unavailable' })}
        {button({ label: 'Đặt làm ảnh chính', disabled: props.status !== 'ready' || images.length === 0 })}
        {button({
          label: 'Xóa ảnh',
          variant: 'destructive',
          disabled: props.status !== 'ready' || images.length === 0,
        })}
      </div>
      {props.extension !== undefined && <div data-ui="media-extension">{props.extension}</div>}
    </section>
  )
}
