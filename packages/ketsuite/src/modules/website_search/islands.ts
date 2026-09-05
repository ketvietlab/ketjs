import { html, signal } from '@ketvietlab/ketjs-view'
import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'

/**
 * The interactive half a theme is not allowed to write. The theme decides whether
 * a search box appears and where; this decides what happens when you type in it.
 *
 * The box posts nowhere: it renders its own results in place. It used to submit
 * to a hardcoded `/tim-kiem` that no route served and no page had to exist at, so
 * a visitor who searched landed on a 404. Results belong next to the box because
 * the query lives in the URL, and a page resolver is handed a path rather than a
 * query string — there is no server-rendered surface that could see it.
 */
export const islands: Record<string, IslandDefinition> = {
  'website.search': {
    props: { label: 'text?', placeholder: 'text?', emptyLabel: 'text?' },
    key: [],
    client: 'search.mjs',
    view: (props: IslandProps) => {
      const open = signal(false)
      const term = signal('')
      return () => html`<div class="search" data-open=${open()}>
        <button on:click=${() => open.set((v) => !v)} aria-expanded=${open()}>${props.label ?? 'Tìm'}</button>
        ${
          open()
            ? html`<form autocomplete="off"><input name="q" value=${term()} autocomplete="off" on:input=${(e: unknown) => term.set(String((e as { target: { value: string } }).target.value))} placeholder=${props.placeholder ?? 'Nhập từ khoá'}></form>`
            : ''
        }
      </div>`
    },
  },
}
