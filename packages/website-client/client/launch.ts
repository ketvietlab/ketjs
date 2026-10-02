// ERP → Website Studio. The Studio is its own application in its own tab: the ERP only links to
// it and never embeds it. Design System links have no `target` (DS gap, see CONTRACT.md), so the
// host delegates: any same-origin link under the Studio base opens a new tab.

export const websiteLaunchHref = ({
  basePath = '/website/',
  site = null,
}: {
  basePath?: string
  site?: string | null
} = {}) => (site ? `${basePath}overview?site=${encodeURIComponent(site)}` : `${basePath}overview`)

/**
 * @param root ERP document or shell element.
 * @returns detach
 */
export function delegateWebsiteLaunch(
  root: EventTarget,
  { basePath = '/website/', open }: { basePath?: string; open?: (url: string) => void } = {},
): () => void {
  const openTab = open ?? ((url: string) => globalThis.open(url, '_blank', 'noopener'))
  const onClick = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]')
    if (!link) return
    const url = new URL(link.href, location.href)
    if (url.origin !== location.origin || !url.pathname.startsWith(basePath)) return
    event.preventDefault()
    openTab(url.href)
  }
  root.addEventListener('click', onClick as EventListener)
  return () => root.removeEventListener('click', onClick as EventListener)
}
