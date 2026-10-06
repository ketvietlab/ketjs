import { THEME_FILE } from './types.ts'

/**
 * The module a themed page loads, generated per version so it can import the theme's entry relatively.
 *
 * It hands `mount` the site root and a frozen context: the settings the site chose, the locale, the
 * page, the JSON the server rendered into `#ket-theme-data`, and `asset(file)` for the version's own
 * files. The page is complete before this runs; a module that throws leaves it as it was.
 */
export const themeBootModule = (entry: string): string => {
  if (!THEME_FILE.test(entry) || !entry.endsWith('.mjs')) throw new Error(`invalid theme entry ${entry}`)
  return `import * as theme from './${entry}'
const FILE = ${THEME_FILE.toString()}
const root = document.querySelector('.wt-site[data-site-theme]')
const source = document.getElementById('ket-theme-data')
if (root && source && typeof theme.mount === 'function') {
  let data = {}
  try {
    data = JSON.parse(source.textContent || '{}') || {}
  } catch {}
  const base = new URL('./', import.meta.url).pathname
  const freeze = (value) => Object.freeze({ ...(value && typeof value === 'object' ? value : {}) })
  const ctx = Object.freeze({
    settings: freeze(data.settings),
    locale: String(data.locale || document.documentElement.lang || 'vi'),
    page: freeze(data.page),
    data: freeze(data.data),
    asset: (file) => (FILE.test(String(file)) ? base + String(file) : ''),
  })
  if (data.interactivePreview === true) {
    // Preview interactions stay in this snapshot: no tel, external navigation or form submission.
    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault()
    })
    document.addEventListener('submit', (event) => event.preventDefault(), true)
  }
  try {
    const mounted = theme.mount(root, ctx)
    if (data.interactivePreview === true) document.documentElement.dataset.builderThemeState = 'ready'
    window.addEventListener('pagehide', () => mounted?.dispose?.(), { once: true })
  } catch (error) {
    console.error('website theme', error)
  }
}
`
}
