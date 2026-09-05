import { each } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { linkButton } from './actions.tsx'
import { recordForm } from './form.tsx'
import { notice } from './state.tsx'
import { stack, surface } from './surfaces.tsx'

export const HOOKS = [
  'login',
  'login-panel',
  'login-brand',
  'login-logo',
  'login-form',
  'login-heading',
  'login-title',
  'login-subtitle',
  'login-error',
  'field',
  'field-label',
  'field-input',
  'login-submit',
  'login-providers',
  'login-divider',
  'login-provider',
  'login-locales',
  'login-locale',
] as const

/**
 * Where the brand lockup is served from.
 *
 * The files sit in `backend/design/`, beside the stylesheet that positions them,
 * because they are a design asset and that directory is what the design team owns.
 * The design harness mounts the same directory at `/design/`, so the base is an
 * option rather than a constant — a hard-coded `/_ket/asset/` path renders a broken
 * image in exactly the place the design is reviewed.
 */
const BRAND = '/_ket/asset/backend/brand'

/**
 * The sign-in screen.
 *
 * A plain form that posts to the same path. A login page that needs JavaScript to
 * work is a login page that fails in the one situation where you most want to get
 * in — and there is nothing here that a form element does not already do. It stays
 * that way: no island, no handler.
 *
 * The lockup sits above the card rather than inside it. It is the one screen that
 * has to say which product this is, and a logo inside the card competes with the
 * heading for the same job; above it, the card stays a form and the page carries
 * the identity. `<picture>` picks the variant from `prefers-color-scheme` because
 * the admin is `color-scheme: light dark` and a dark wordmark on the dark canvas is
 * invisible — no script, and no flash of the wrong one.
 *
 * `next` is carried through, so arriving at /admin uninvited and signing in lands
 * where you were going rather than at a default somebody picked.
 *
 * It lives in the kit rather than in the `user` module because markup does — it was
 * the last product screen writing its own, and `ui-audit` had been carrying it on a
 * pending list since before `form.tsx` existed.
 */
export const loginScreen = (
  _: Translator,
  o: {
    next?: string
    failed?: boolean
    oauthFailed?: boolean
    providers?: Array<{ code: string; name: string; href: string }>
    locales?: string[]
    locale?: string
    brand?: string
  } = {},
): TemplateResult => (
  <div data-ui="login">
    <main data-ui="login-panel">
      <picture data-ui="login-brand">
        <source srcset={`${o.brand ?? BRAND}/logo-dark.png`} media="(prefers-color-scheme: dark)" />
        <img
          data-ui="login-logo"
          src={`${o.brand ?? BRAND}/logo-light.png`}
          alt={_('user.login.brand')}
          width="600"
          height="160"
        />
      </picture>
      <form data-ui="login-form" method="post" action="/login">
        <div data-ui="login-heading">
          <h1 data-ui="login-title">{_('user.login.title')}</h1>
          <p data-ui="login-subtitle">{_('user.login.subtitle')}</p>
        </div>
        {o.failed === true && (
          <p data-ui="login-error" role="alert">
            {_('user.login.failed')}
          </p>
        )}
        {o.oauthFailed === true && (
          <p data-ui="login-error" role="alert">
            {_('oauth.login.failed')}
          </p>
        )}
        <label data-ui="field">
          <span data-ui="field-label">{_('user.login.login')}</span>
          <input data-ui="field-input" name="login" autocomplete="off" autofocus required />
        </label>
        <label data-ui="field">
          <span data-ui="field-label">{_('user.login.password')}</span>
          <input data-ui="field-input" name="password" type="password" autocomplete="off" required />
        </label>
        {o.next !== undefined && <input type="hidden" name="next" value={o.next} autocomplete="off" />}
        <button data-ui="login-submit" type="submit">
          {_('user.login.submit')}
        </button>
        {(o.providers?.length ?? 0) > 0 && (
          <div data-ui="login-providers">
            <span data-ui="login-divider">{_('oauth.login.or')}</span>
            {each(
              o.providers ?? [],
              (provider) => provider.code,
              (provider) => (
                <a data-ui="login-provider" href={provider.href}>
                  {_('oauth.login.continueWith', { provider: provider.name })}
                </a>
              ),
            )}
          </div>
        )}
      </form>
      {/* Beside the card, not in it: picking a language is navigation away from
          this form, not a field of it. */}
      {(o.locales?.length ?? 0) > 1 && (
        <p data-ui="login-locales">
          {each(
            o.locales ?? [],
            (l) => l,
            (l) => (
              <a data-ui="login-locale" data-active={String(l === o.locale)} href={`/login?lang=${l}`}>
                {l}
              </a>
            ),
          )}
        </p>
      )}
    </main>
  </div>
)

export const authTokenScreen = (
  _: Translator,
  options: { kind: 'invitation' | 'reset'; token: string; errors?: string[]; complete?: boolean },
): TemplateResult =>
  options.complete
    ? stack([
        notice({
          tone: 'positive',
          title: _('user.token.completeTitle'),
          message: _('user.token.completeHint'),
          actions: linkButton({ label: _('user.token.signIn'), href: '/login', variant: 'primary' }),
        }),
      ])
    : stack([
        notice({
          tone: 'info',
          title: _(`user.token.${options.kind}Title`),
          message: _(`user.token.${options.kind}Hint`),
        }),
        surface({
          body: recordForm({
            action: `/auth/${options.kind}`,
            submit: _('user.token.submit'),
            submitVariant: 'primary',
            errors: options.errors,
            hidden: { token: options.token },
            fields: [
              {
                name: 'password',
                label: _('user.token.password'),
                type: 'password',
                required: true,
              },
              {
                name: 'confirmPassword',
                label: _('user.token.confirmPassword'),
                type: 'password',
                required: true,
              },
            ],
          }),
        }),
      ])
