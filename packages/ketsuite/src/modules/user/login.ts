import { each, html, when } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import type { Translator } from 'ketjs'

/**
 * The sign-in screen.
 *
 * A plain form that posts to the same path. A login page that needs JavaScript to
 * work is a login page that fails in the one situation where you most want to get
 * in — and there is nothing here that a form element does not already do.
 *
 * `next` is carried through, so arriving at /admin uninvited and signing in lands
 * where you were going rather than at a default somebody picked.
 *
 * Markup only, as everywhere in this module: the look belongs to the design team
 * and the selectors are the data-ui attributes. See design/HANDOFF.md.
 */
export const loginScreen = (
  _: Translator,
  o: { next?: string; failed?: boolean; locales?: string[]; locale?: string } = {},
): TemplateResult => html`
<div data-ui="login">
  <form data-ui="login-form" method="post" action="/login">
    <h1 data-ui="login-title">${_('user.login.title')}</h1>
    ${when(
      o.failed === true,
      () => html`
      <p data-ui="login-error" role="alert">${_('user.login.failed')}</p>`,
    )}
    <label data-ui="field">
      <span data-ui="field-label">${_('user.login.login')}</span>
      <input data-ui="field-input" name="login" autocomplete="username" autofocus required>
    </label>
    <label data-ui="field">
      <span data-ui="field-label">${_('user.login.password')}</span>
      <input data-ui="field-input" name="password" type="password" autocomplete="current-password" required>
    </label>
    ${when(o.next !== undefined, () => html`<input type="hidden" name="next" value=${o.next}>`)}
    <button data-ui="login-submit" type="submit">${_('user.login.submit')}</button>
    ${when(
      (o.locales?.length ?? 0) > 1,
      () => html`
      <p data-ui="login-locales">${each(
        o.locales ?? [],
        (l) => l,
        (l) => html`
        <a data-ui="login-locale" data-active=${String(l === o.locale)} href=${`/login?lang=${l}`}>${l}</a>`,
      )}</p>`,
    )}
  </form>
</div>`
