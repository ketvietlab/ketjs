import { text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { CUSTOMER_SIGNIN_PATH, customerReturnPath, renderStudioPublic } from './public.ts'
import { publicSiteOf } from './public-site.ts'

/**
 * The customer sign-in of a Studio site: `/account/login?returnTo=`.
 *
 * The page is the site's own, in the look of its home page; signing in is the customer API's, which
 * the page's script calls, because only that API may set the session cookie. A site whose customer
 * realm is closed has no sign-in to show. A form posted without the script is sent back to the page
 * rather than read: the password was never meant for this route.
 */
const signinPage =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    const returnTo = customerReturnPath(url.searchParams.get('returnTo'))
    const self =
      returnTo === '/' ? CUSTOMER_SIGNIN_PATH : `${CUSTOMER_SIGNIN_PATH}?${new URLSearchParams({ returnTo })}`
    if (req.method === 'POST') return withHeaders(text('', { status: 303 }), { location: self })
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return withHeaders(text('', { status: 405 }), { allow: 'GET, HEAD, POST' })
    const publicSite = await publicSiteOf(ctx, url, req)
    if (!publicSite) return text('', { status: 404 })
    const { site } = publicSite
    const realm = await ctx.call('website.customerRealmForSite', { siteId: site.id }, url, req)
    if (!realm) return text('', { status: 404 })
    const title = publicSite.locale === 'vi' ? 'Đăng nhập' : 'Sign in'
    return (
      renderStudioPublic({
        site,
        locale: publicSite.locale,
        menu: publicSite.menu,
        page: { id: 'customer-signin', path: CUSTOMER_SIGNIN_PATH, title, type: 'website.customerSignin' },
        fields: {
          seo: { title, description: '', canonical: '', indexing: 'noindex' },
          signin: { returnTo },
        },
        appearance: publicSite.appearance,
        meta: {},
        sections: [],
      }) ?? text('', { status: 404 })
    )
  }

/** The customer's own pages beside the sign-in; each is the site's, in the look of its home page. */
export const CUSTOMER_ACCOUNT_PATH = '/account'
export const CUSTOMER_FORGOT_PATH = '/account/forgot'
export const CUSTOMER_RESET_PATH = '/account/reset'
const customerViews = {
  [CUSTOMER_ACCOUNT_PATH]: ['profile', 'Tài khoản của tôi', 'My account'],
  [CUSTOMER_FORGOT_PATH]: ['forgot', 'Quên mật khẩu', 'Forgot password'],
  [CUSTOMER_RESET_PATH]: ['reset', 'Đặt mật khẩu mới', 'Choose a new password'],
} as const

/**
 * A customer page: what it shows depends on who is signed in, so the script fills it from the
 * customer API, as on the sign-in. A reset link's token stays in the address and is read there;
 * it is never written into the page.
 */
const customerPage =
  (path: keyof typeof customerViews) =>
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return withHeaders(text('', { status: 405 }), { allow: 'GET, HEAD' })
    const publicSite = await publicSiteOf(ctx, url, req)
    if (!publicSite) return text('', { status: 404 })
    const { site } = publicSite
    const realm = await ctx.call('website.customerRealmForSite', { siteId: site.id }, url, req)
    if (!realm) return text('', { status: 404 })
    const [view, vi, en] = customerViews[path]
    const title = publicSite.locale === 'vi' ? vi : en
    return (
      renderStudioPublic({
        site,
        locale: publicSite.locale,
        menu: publicSite.menu,
        page: { id: `customer-${view}`, path, title, type: 'website.customerAccount' },
        fields: {
          seo: { title, description: '', canonical: '', indexing: 'noindex' },
          customer: { view },
        },
        appearance: publicSite.appearance,
        meta: {},
        sections: [],
      }) ?? text('', { status: 404 })
    )
  }

export const accountRoutes: Record<string, RouteEntry> = {
  [CUSTOMER_SIGNIN_PATH]: { anonymous: true, handler: signinPage },
  ...Object.fromEntries(
    Object.keys(customerViews).map((path) => [
      path,
      { anonymous: true, handler: customerPage(path as keyof typeof customerViews) },
    ]),
  ),
}
