// @ts-expect-error Browser import served by the KetJS runtime.
import { html, signal } from '/_ket/view/index.js'

/**
 * Browser half of website.search.
 *
 * The box used to post to a hardcoded `/tim-kiem` that nothing served, so a
 * visitor who searched landed on a 404. It now submits to the page it is already
 * on and renders the answer in place: the query lives in the URL, which is the
 * one thing a server-rendered page cannot see — the page resolver is handed a
 * path, not a query string.
 *
 * Results come from the same anonymous functions the sitemap and the public
 * reader agree with, so anything offered here is a page the reader will serve.
 *
 * @param {{ label?: string, placeholder?: string, emptyLabel?: string }} props
 */
export default function websiteSearch(props) {
  const params = new URLSearchParams(location.search)
  const initial = params.get('q') ?? ''

  const open = signal(initial.trim().length > 0)
  const term = signal(initial)
  const state = signal(/** @type {'idle'|'loading'|'ready'|'failed'} */ ('idle'))
  const hits = signal(
    /** @type {Array<{id: string, path: string, title: string, excerpt: string|null}>} */ ([]),
  )
  const total = signal(0)
  const capped = signal(false)

  /** @param {string} fn @param {Record<string, unknown>} input */
  const post = async (fn, input) => {
    const response = await fetch(`/_ket/fn/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(String(response.status))
    return (await response.json()).data
  }

  /** @param {string} q */
  const load = async (q) => {
    // The site is resolved from the request host, the same way the storefront
    // resolved the page this box is rendered on.
    const site = await post('website.resolveSite', { host: location.host })
    if (!site?.id) throw new Error('no site')
    // One call rather than two: the index answers the page and the total
    // together, and tells us whether it is behind what is being served.
    const found = await post('website_search.searchIndexed', { siteId: site.id, q, limit: 20 })
    hits.set(Array.isArray(found?.hits) ? found.hits : [])
    total.set(Number(found?.total ?? 0))
    capped.set(found?.stale === true)
    state.set('ready')
  }

  /** @param {string} q */
  const search = (q) => {
    // Two characters is the same floor searchPublished applies; asking below it
    // spends a request to be told nothing.
    if (q.trim().length < 2) {
      state.set('idle')
      hits.set([])
      return
    }
    state.set('loading')
    load(q).catch(() => state.set('failed'))
  }

  if (initial) search(initial)

  function toggleOpen() {
    open.set(!open())
  }
  /** @param {Event} event */
  function updateTerm(event) {
    const input = /** @type {HTMLInputElement} */ (event.target)
    term.set(String(input.value))
  }
  /** @param {Event} event */
  function submit(event) {
    event.preventDefault()
    const q = term()
    // Keep the query in the URL so a result page can be linked and reloaded.
    const next = new URL(location.href)
    if (q.trim()) next.searchParams.set('q', q)
    else next.searchParams.delete('q')
    history.replaceState(null, '', next)
    search(q)
  }

  const summary = () => {
    if (state() === 'loading') return 'Đang tìm…'
    if (state() === 'failed') return 'Không tải được kết quả. Hãy thử lại.'
    if (hits().length === 0) return props.emptyLabel ?? 'Không có nội dung nào khớp từ khoá này.'
    // `capped` now means the index is still catching up, so the count is a floor.
    return `${total()}${capped() ? '+' : ''} kết quả cho “${term()}”`
  }

  return () => html`<div class="search" data-open=${open()} data-state=${state()}>
    <button on:click=${toggleOpen} aria-expanded=${open()}>${props.label ?? 'Tìm'}</button>
    ${
      open()
        ? html`<form autocomplete="off" on:submit=${submit}>
            <input
              name="q"
              value=${term()}
              autocomplete="off"
              on:input=${updateTerm}
              placeholder=${props.placeholder ?? 'Nhập từ khoá'}
            >
          </form>`
        : ''
    }
    ${
      open() && state() !== 'idle'
        ? html`<div class="search-results" role="region" aria-live="polite">
            <p class="search-results-summary">${summary()}</p>
            <ul class="search-results-list">
              ${hits().map(
                (/** @type {{ path: string, title: string, excerpt: string|null }} */ hit) => html`<li>
                  <a href=${hit.path}>${hit.title}</a>
                  ${hit.excerpt ? html`<p>${hit.excerpt}</p>` : ''}
                </li>`,
              )}
            </ul>
          </div>`
        : ''
    }
  </div>`
}
