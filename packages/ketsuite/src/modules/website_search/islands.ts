import { html, signal } from '@ketvietlab/ketjs-view'
import type { IslandDefinition, IslandProps } from '@ketvietlab/ketjs-view'

/**
 * The interactive half a theme is not allowed to write. The theme decides whether
 * a search box appears and where; this decides what happens when you type in it.
 */
export const islands: Record<string, IslandDefinition> = {
  'website.search': {
    props: { label: 'text?' },
    key: [],
    client: 'search.mjs',
    view: (props: IslandProps) => {
      const open = signal(false)
      const term = signal('')
      return () => html`<div class="search" data-open=${open()}>
        <button on:click=${() => open.set((v) => !v)} aria-expanded=${open()}>${props.label ?? 'Tìm'}</button>
        ${
          open()
            ? html`<form action="/tim-kiem" autocomplete="off"><input name="q" value=${term()} autocomplete="off" on:input=${(e: unknown) => term.set(String((e as { target: { value: string } }).target.value))} placeholder="Nhập từ khoá"></form>`
            : ''
        }
      </div>`
    },
  },
}
