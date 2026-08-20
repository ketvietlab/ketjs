// @ts-expect-error Browser import served by the KetJS runtime.
import { html, signal } from '/_ket/view/index.js'

/** Browser half of website.search. The factory creates state once per island. */
/** @param {{ label?: string }} props */
export default function websiteSearch(props) {
  const open = signal(false)
  const term = signal('')
  function toggleOpen() {
    open.set(!open())
  }
  /** @param {Event} event */
  function updateTerm(event) {
    const input = /** @type {HTMLInputElement} */ (event.target)
    term.set(String(input.value))
  }
  return () => html`<div class="search" data-open=${open()}>
    <button on:click=${toggleOpen} aria-expanded=${open()}>${props.label ?? 'Tìm'}</button>
    ${
      open()
        ? html`<form action="/tim-kiem"><input name="q" value=${term()} on:input=${updateTerm} placeholder="Nhập từ khoá"></form>`
        : ''
    }
  </div>`
}
