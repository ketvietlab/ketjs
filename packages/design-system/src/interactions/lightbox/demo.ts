import type { LightboxConfig } from './index.tsx'

// Inline SVG pictures, so the catalogue specimen needs no network or asset files.
const picture = (fill: string, label: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720"><rect width="960" height="720" fill="${fill}"/><text x="480" y="380" font-family="sans-serif" font-size="64" fill="#fff" text-anchor="middle">${label}</text></svg>`,
  )}`

export const lightboxDemoConfig: LightboxConfig = {
  thumbnails: 'all',
  items: [
    { src: picture('#1d4ed8', 'Front'), alt: 'Jacket, front', caption: 'Front' },
    { src: picture('#b45309', 'Back'), alt: 'Jacket, back', caption: 'Back' },
    { src: picture('#047857', 'Detail'), alt: 'Jacket, collar detail', caption: 'Collar detail' },
  ],
  labels: {
    open: 'Open {alt}',
    close: 'Close',
    previous: 'Previous image',
    next: 'Next image',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    counter: '{index} / {total}',
    empty: 'No image',
  },
}
