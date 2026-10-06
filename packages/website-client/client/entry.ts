import { createRoot, domHost, effect } from '@ketvietlab/ketjs-view'
import type { HostNode } from '@ketvietlab/ketjs-view'
import { uploadImage } from './image-upload.tsx'
import { createWebsiteStudio, createFnClient } from './index.ts'
const root = document.getElementById('website-studio')
if (root) {
  const props = JSON.parse(root.dataset.props!)
  const call = createFnClient({
    fetch: async (url, options) => {
      const response = await fetch(String(url).replace('/_ket/fn/', '/website/api/'), options)
      if (response.status === 401) {
        const next = window.location.pathname + window.location.search
        window.location.assign(`/login?next=${encodeURIComponent(next)}`)
      }
      return response
    },
  })
  const studio = createWebsiteStudio(props, {
    call,
    uploadImage: (file, options) =>
      uploadImage(file, {
        ...options,
        endpoint: options.resModel?.startsWith('website_catalog.')
          ? `/website/catalog/images/${encodeURIComponent(options.resModel.split('.')[1]!)}/${encodeURIComponent(options.id)}/${encodeURIComponent(options.field)}?site=${encodeURIComponent(options.siteId)}`
          : `/website/images/${encodeURIComponent(options.id)}/${encodeURIComponent(options.field)}?site=${encodeURIComponent(options.siteId)}`,
      }),
  })
  const view = createRoot(domHost(), root as unknown as HostNode)
  const lifetime = new AbortController()
  const stop = effect(() => view.render(studio.view()))
  studio.mount({ root, lifetime: lifetime.signal })
  window.addEventListener(
    'pagehide',
    () => {
      lifetime.abort()
      stop()
      studio.dispose()
      view.dispose()
    },
    { once: true },
  )
}
