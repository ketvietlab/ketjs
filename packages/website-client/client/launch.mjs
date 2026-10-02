// ERP → Website Studio. The Studio is its own application in its own tab: the ERP only links to
// it and never embeds it. Design System links have no `target` (DS gap, see CONTRACT.md), so the
// host delegates: any same-origin link under the Studio base opens a new tab.

/** @param {{ basePath?: string, site?: string | null }} [options] */
export const websiteLaunchHref = ({ basePath = '/website/', site = null } = {}) =>
  site ? `${basePath}overview?site=${encodeURIComponent(site)}` : `${basePath}overview`

/**
 * @param {EventTarget} root ERP document or shell element.
 * @param {{ basePath?: string, open?: (url: string) => void }} [options]
 * @returns {() => void} detach
 */
export function delegateWebsiteLaunch(root, { basePath = '/website/', open } = {}) {
  const openTab = open ?? ((url) => globalThis.open(url, '_blank', 'noopener'))
  const onClick = (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    const link = event.target.closest?.('a[href]')
    if (!link) return
    const url = new URL(link.href, location.href)
    if (url.origin !== location.origin || !url.pathname.startsWith(basePath)) return
    event.preventDefault()
    openTab(url.href)
  }
  root.addEventListener('click', onClick)
  return () => root.removeEventListener('click', onClick)
}
