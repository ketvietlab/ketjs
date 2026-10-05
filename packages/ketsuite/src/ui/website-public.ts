import { html, each, trustedMarkup } from '@ketvietlab/ketjs-view'
import type { TemplateResult } from '@ketvietlab/ketjs-view'

// The public website and the Studio page that edits it are whole documents, not admin screens:
// a visitor's page has no backend frame, and the Studio mounts its own client inside an empty one.
// Every href and image arrives already checked; this file decides only how they read.

export type WebsitePublicEntry = {
  id: string
  href: string
  title: unknown
  publishedAt?: unknown
  excerpt?: unknown
}
export type WebsitePublicPager = { previous?: string | null; next?: string | null }
export type WebsitePublicNavItem = {
  id: string
  href: string
  label: unknown
  /** Null when the item has no children; an empty list still opens a nested list. */
  children: WebsitePublicNavItem[] | null
}
export type WebsitePublicListing =
  | {
      kind: 'archive'
      title: unknown
      /** Rendered from the description document; when present it replaces the plain description. */
      descriptionHtml?: string | null
      description?: unknown
      entries: WebsitePublicEntry[]
      pager: WebsitePublicPager
    }
  | {
      kind: 'search'
      title: unknown
      query: string
      type: unknown
      total: number
      stale: boolean
      entries: WebsitePublicEntry[]
      pager: WebsitePublicPager
    }
  | {
      kind: 'receipt'
      title: unknown
      message: unknown
      code?: unknown
      createdAt?: unknown
      createdLabel?: unknown
    }
  | {
      kind: 'signin'
      title: unknown
      /** A same-site path, already checked; where a signed-in visitor goes next. */
      returnTo: string
      selfSignup: boolean
    }
  | {
      /** The customer's own pages: their account, asking for a reset link, and using one. */
      kind: 'customer'
      title: unknown
      view: 'profile' | 'register' | 'forgot' | 'reset'
    }
  | {
      /** A page a deployment module draws itself, inside the site's header and footer. */
      kind: 'embed'
      title: unknown
      /** Same-origin asset paths, already checked. */
      script: string
      style: string | null
    }
export type WebsitePublicPage = {
  locale: string
  head: {
    title: string
    description?: unknown
    noindex?: boolean
    canonical?: string | null
    ogType: 'article' | 'website'
    ogImage?: string | null
    ogUrl?: string | null
    siteName: unknown
  }
  theme: { preset: unknown; accent: unknown; font: unknown; spacing: unknown; buttons: unknown }
  /**
   * One of the company's own themes, loaded after `public.css`. `script` is null wherever theme code
   * must not run (a preview, a staff session, a host that is not the site's own); the page is complete
   * without it.
   */
  siteTheme?: {
    key: string
    stylesheet: string
    script: string | null
    /** Already safe inside a script element (see `scriptJson`); written whole, so no marker lands in it. */
    data: string
  } | null
  brand: { title: unknown; logo?: string | null }
  navigation: WebsitePublicNavItem[]
  /** The header's way to a customer account; null when the site does not offer one. */
  account?: { href: string } | null
  listing: WebsitePublicListing | null
  /** A post's body, rendered from its document. */
  article: { title: unknown; bodyHtml: string } | null
  sections: unknown
  footer: unknown
}

// An archive and a search list entries the same way: a title to open, its date, a few words.
const entryList = (rows: WebsitePublicEntry[]) =>
  html`<ol>${each(
    rows,
    (row) => row.id,
    (row) =>
      html`<li><article><h2><a href=${row.href}>${row.title}</a></h2>${row.publishedAt ? html`<time datetime=${String(row.publishedAt)}>${String(row.publishedAt).slice(0, 10)}</time>` : null}${row.excerpt ? html`<p>${row.excerpt}</p>` : null}</article></li>`,
  )}</ol>`

const pager = ({ previous, next }: WebsitePublicPager, vi: boolean) =>
  previous || next
    ? html`<nav aria-label=${vi ? 'Phân trang' : 'Pagination'}>${previous ? html`<a rel="prev" href=${previous}>${vi ? 'Trang trước' : 'Previous page'}</a>` : html`<span></span>`}${next ? html`<a rel="next" href=${next}>${vi ? 'Trang sau' : 'Next page'}</a>` : null}</nav>`
    : null

// Line icons for the sign-in, 24px, stroked in the text colour.
const ICON_PATHS = {
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  phone:
    '<path d="M6.5 3h3l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A17 17 0 0 1 4.5 5a2 2 0 0 1 2-2Z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
} as const
const icon = (name: keyof typeof ICON_PATHS) =>
  html`<svg class="wt-public-signin__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${trustedMarkup(ICON_PATHS[name])}</svg>`

/** What the sign-in says, in the page's language; the script reads the words it shows from here. */
const signinWords = (vi: boolean, site: string, selfSignup: boolean) =>
  vi
    ? {
        eyebrow: 'Tài khoản khách hàng',
        headline: `Chào mừng bạn quay lại ${site}.`,
        benefits: [
          [
            'user',
            selfSignup ? 'Tạo tài khoản của bạn' : 'Tài khoản do cửa hàng cấp',
            selfSignup
              ? 'Đăng ký để theo dõi thông tin và lịch sử của riêng bạn.'
              : 'Cửa hàng tạo sẵn tài khoản khi bắt đầu phục vụ bạn.',
          ],
          ['phone', 'Đăng nhập bằng số điện thoại', 'Hoặc email bạn đã để lại cho cửa hàng.'],
          ['lock', 'Thông tin của riêng bạn', 'Chỉ bạn và cửa hàng xem được.'],
        ],
        lead: selfSignup
          ? 'Dùng email hoặc số điện thoại và mật khẩu của tài khoản bạn.'
          : 'Dùng số điện thoại hoặc email và mật khẩu cửa hàng đã gửi cho bạn.',
        login: 'Số điện thoại hoặc email',
        loginHint: '0900 000 000 hoặc email',
        password: 'Mật khẩu',
        show: 'Hiện mật khẩu',
        submit: 'Đăng nhập',
        forgot: ['Quên mật khẩu?', 'Đặt lại mật khẩu'],
        noAccount: ['Chưa có tài khoản?', 'Tài khoản được cấp khi bạn bắt đầu dùng dịch vụ của cửa hàng.'],
        register: 'Tạo tài khoản',
        secure: 'Thông tin chỉ dùng để cửa hàng phục vụ bạn.',
        signedAs: 'Bạn đang đăng nhập với tên ',
        continue: 'Tiếp tục',
        account: 'Tài khoản của tôi',
        signout: 'Đăng xuất',
        noscript: 'Cần bật JavaScript trên trình duyệt để đăng nhập.',
        script: {
          loginMissing: 'Nhập số điện thoại hoặc email.',
          passwordMissing: 'Nhập mật khẩu.',
          invalid: [
            'danger',
            'Thông tin chưa đúng',
            'Bạn kiểm tra lại số điện thoại hoặc email và mật khẩu nhé.',
          ],
          limited: [
            'warning',
            'Bạn đã thử quá nhiều lần',
            'Vui lòng chờ ít phút rồi đăng nhập lại, hoặc liên hệ cửa hàng.',
          ],
          failed: ['danger', 'Chưa kết nối được', 'Vui lòng kiểm tra mạng rồi thử lại.'],
          signedOut: ['info', 'Bạn đã đăng xuất', 'Hẹn gặp lại bạn lần sau.'],
          show: 'Hiện mật khẩu',
          hide: 'Ẩn mật khẩu',
          busy: 'Đang đăng nhập…',
        },
      }
    : {
        eyebrow: 'Customer account',
        headline: `Welcome back to ${site}.`,
        benefits: [
          [
            'user',
            selfSignup ? 'Create your account' : 'An account from the shop',
            selfSignup
              ? 'Sign up to see your details and history in one place.'
              : 'The shop creates it when it starts serving you.',
          ],
          ['phone', 'Sign in with your phone number', 'Or the email you gave the shop.'],
          ['lock', 'Your information, kept yours', 'Seen only by you and the shop.'],
        ],
        lead: selfSignup
          ? 'Use your email or phone number and account password.'
          : 'Use the phone number or email and the password the shop sent you.',
        login: 'Phone number or email',
        loginHint: '0900 000 000 or email',
        password: 'Password',
        show: 'Show password',
        submit: 'Sign in',
        forgot: ['Forgot your password?', 'Reset it'],
        noAccount: ['No account yet?', 'The shop gives you one when you start using its services.'],
        register: 'Create an account',
        secure: 'Only used by the shop to serve you.',
        signedAs: 'You are signed in as ',
        continue: 'Continue',
        account: 'My account',
        signout: 'Sign out',
        noscript: 'Signing in needs JavaScript in your browser.',
        script: {
          loginMissing: 'Enter your phone number or email.',
          passwordMissing: 'Enter your password.',
          invalid: ['danger', 'That did not match', 'Check your phone number or email and your password.'],
          limited: ['warning', 'Too many attempts', 'Wait a few minutes and try again, or contact the shop.'],
          failed: ['danger', 'Could not connect', 'Check your connection and try again.'],
          signedOut: ['info', 'You are signed out', 'See you next time.'],
          show: 'Show password',
          hide: 'Hide password',
          busy: 'Signing in…',
        },
      }

/**
 * The customer sign-in: the site's welcome beside the form, the form first on a phone. The form talks
 * to the customer API from a script, whose words it carries here so they stay in the page's language;
 * a browser without scripts is told so instead. The welcome names only what every site's account is.
 */
const signin = (
  value: Extract<WebsitePublicListing, { kind: 'signin' }>,
  vi: boolean,
  brand: WebsitePublicPage['brand'],
) => {
  const w = signinWords(vi, String(brand.title ?? ''), value.selfSignup)
  return html`<section class="wt-public-signin" data-customer-signin data-return-to=${value.returnTo} data-messages=${JSON.stringify(w.script)}><div class="wt-public-signin__story">${brand.logo ? html`<img class="wt-public-signin__mark" src=${brand.logo} alt="">` : null}<p class="wt-public-signin__eyebrow">${w.eyebrow}</p><p class="wt-public-signin__headline">${w.headline}</p><ul class="wt-public-signin__benefits">${each(
    w.benefits,
    ([name]) => name,
    ([name, title, text]) =>
      html`<li>${icon(name as keyof typeof ICON_PATHS)}<span><strong>${title}</strong>${text}</span></li>`,
  )}</ul></div><div class="wt-public-signin__panel"><div class="wt-public-signin__card"><h1>${value.title}</h1><p class="wt-public-signin__lead" data-signin-guest>${w.lead}</p><div class="wt-public-signin__notice" role="alert" hidden><strong></strong><span></span></div><div class="wt-public-signin__guest" data-signin-guest><form class="wt-public-signin__form" method="post" novalidate><label class="wt-public-signin__field"><span id="wt-signin-login-label">${w.login}</span><input name="login" aria-labelledby="wt-signin-login-label" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" placeholder=${w.loginHint} aria-describedby="wt-signin-login-error" required><small class="wt-public-signin__error" id="wt-signin-login-error" hidden></small></label><label class="wt-public-signin__field"><span id="wt-signin-password-label">${w.password}</span><span class="wt-public-signin__password"><input type="password" name="password" aria-labelledby="wt-signin-password-label" autocomplete="current-password" maxlength="128" aria-describedby="wt-signin-password-error" required><button class="wt-public-signin__reveal" type="button" aria-label=${w.show} aria-pressed="false">${icon('eye')}</button></span><small class="wt-public-signin__error" id="wt-signin-password-error" hidden></small></label><button class="wt-button" type="submit">${w.submit}</button></form><div class="wt-public-signin__help"><p><strong>${w.forgot[0]}</strong> <a href="/account/forgot">${w.forgot[1]}</a></p><p><strong>${w.noAccount[0]}</strong> ${value.selfSignup ? html`<a href="/account/register">${w.register}</a>` : w.noAccount[1]}</p></div></div><div class="wt-public-signin__signed" hidden><p>${w.signedAs}<strong data-customer-name></strong>.</p><div class="wt-public-signin__actions"><a class="wt-button" href=${value.returnTo}>${w.continue}</a><a href="/account">${w.account}</a><button class="wt-public-signin__signout" type="button">${w.signout}</button></div></div><p class="wt-public-signin__secure">${icon('lock')}<span>${w.secure}</span></p><noscript><p>${w.noscript}</p></noscript></div></div></section>`
}

/** What the customer's own pages say; the script reads the words it shows from here. */
const customerWords = (vi: boolean) =>
  vi
    ? {
        login: 'Số điện thoại hoặc email',
        loginHint: '0900 000 000 hoặc email',
        forgotLead:
          'Nhập số điện thoại hoặc email của tài khoản. Nếu tài khoản có email, chúng tôi gửi liên kết đặt lại mật khẩu.',
        registerLead: 'Tạo tài khoản bằng tên, email và mật khẩu của bạn.',
        registerSubmit: 'Tạo tài khoản',
        haveAccount: 'Đã có tài khoản?',
        emailAddress: 'Địa chỉ email',
        forgotSubmit: 'Gửi liên kết',
        noEmail: ['Tài khoản không có email?', 'Liên hệ cửa hàng để được cấp lại mật khẩu.'],
        backToSignin: 'Quay lại đăng nhập',
        resetLead: 'Chọn mật khẩu mới từ 6 ký tự trở lên. Mọi thiết bị đang đăng nhập sẽ được đăng xuất.',
        newPassword: 'Mật khẩu mới',
        resetSubmit: 'Lưu mật khẩu mới',
        askAgain: 'Gửi lại liên kết',
        guestLead: 'Đăng nhập để xem và sửa thông tin tài khoản của bạn.',
        signin: 'Đăng nhập',
        phone: 'Số điện thoại',
        email: 'Email',
        displayName: 'Tên hiển thị',
        saveName: 'Lưu tên',
        changePassword: 'Đổi mật khẩu',
        orders: 'Đơn hàng của tôi',
        bookings: 'Đặt phòng của tôi',
        currentPassword: 'Mật khẩu hiện tại',
        signout: 'Đăng xuất',
        noscript: 'Cần bật JavaScript trên trình duyệt để dùng trang này.',
        script: {
          history: {
            empty: 'Chưa có lịch sử nào.',
            loading: 'Đang tải lịch sử…',
            failed: 'Chưa tải được lịch sử. Vui lòng thử lại.',
            more: 'Xem thêm',
            retry: 'Thử lại',
            from: 'Từ',
            to: 'đến',
            states: {
              draft: 'Đang xử lý',
              sent: 'Đã gửi',
              sale: 'Đã xác nhận',
              done: 'Hoàn tất',
              confirmed: 'Đã xác nhận',
              checked_in: 'Đã nhận phòng',
              checked_out: 'Đã trả phòng',
              cancelled: 'Đã huỷ',
              no_show: 'Không đến',
            },
          },
          loginMissing: 'Nhập số điện thoại hoặc email.',
          passwordMissing: 'Nhập mật khẩu.',
          nameMissing: 'Nhập tên hiển thị.',
          emailMissing: 'Nhập địa chỉ email.',
          emailInvalid: 'Địa chỉ email chưa hợp lệ.',
          emailUsed: ['danger', 'Email đã được dùng', 'Bạn đăng nhập hoặc đặt lại mật khẩu nhé.'],
          signupClosed: [
            'warning',
            'Đăng ký đang tạm đóng',
            'Vui lòng liên hệ cửa hàng để được cấp tài khoản.',
          ],
          nameInvalid: ['danger', 'Tên chưa hợp lệ', 'Nhập tên từ 1 đến 200 ký tự.'],
          sent: [
            'info',
            'Đã ghi nhận yêu cầu',
            'Nếu thông tin khớp với một tài khoản có email, liên kết đặt lại đã được gửi và dùng được trong 30 phút.',
          ],
          expired: [
            'danger',
            'Liên kết không còn dùng được',
            'Liên kết đã hết hạn hoặc đã được dùng. Bạn gửi lại liên kết mới nhé.',
          ],
          reset: ['info', 'Đã đổi mật khẩu', 'Bạn đăng nhập bằng mật khẩu mới nhé.'],
          short: ['danger', 'Mật khẩu chưa hợp lệ', 'Mật khẩu cần từ 6 đến 128 ký tự.'],
          wrongPassword: ['danger', 'Mật khẩu hiện tại chưa đúng', 'Bạn kiểm tra lại rồi thử lần nữa.'],
          saved: ['info', 'Đã lưu', 'Thông tin tài khoản đã được cập nhật.'],
          changed: ['info', 'Đã đổi mật khẩu', 'Các thiết bị khác đã được đăng xuất.'],
          limited: ['warning', 'Bạn đã thử quá nhiều lần', 'Vui lòng chờ ít phút rồi thử lại.'],
          failed: ['danger', 'Chưa kết nối được', 'Vui lòng kiểm tra mạng rồi thử lại.'],
          show: 'Hiện mật khẩu',
          hide: 'Ẩn mật khẩu',
          busy: 'Đang gửi…',
        },
      }
    : {
        login: 'Phone number or email',
        loginHint: '0900 000 000 or email',
        registerLead: 'Create an account with your name, email and password.',
        registerSubmit: 'Create account',
        haveAccount: 'Already have an account?',
        emailAddress: 'Email address',
        forgotLead:
          'Enter the phone number or email of your account. If the account has an email, we send a link to reset the password.',
        forgotSubmit: 'Send the link',
        noEmail: ['No email on your account?', 'Contact the shop to get a new password.'],
        backToSignin: 'Back to sign in',
        resetLead: 'Choose a new password of 6 characters or more. Every device signed in is signed out.',
        newPassword: 'New password',
        resetSubmit: 'Save the new password',
        askAgain: 'Send a new link',
        guestLead: 'Sign in to see and edit your account.',
        signin: 'Sign in',
        phone: 'Phone number',
        email: 'Email',
        displayName: 'Display name',
        saveName: 'Save name',
        changePassword: 'Change password',
        orders: 'My orders',
        bookings: 'My bookings',
        currentPassword: 'Current password',
        signout: 'Sign out',
        noscript: 'This page needs JavaScript in your browser.',
        script: {
          history: {
            empty: 'No history yet.',
            loading: 'Loading your history…',
            failed: 'Could not load your history. Please try again.',
            more: 'Show more',
            retry: 'Try again',
            from: 'From',
            to: 'to',
            states: {
              draft: 'Processing',
              sent: 'Sent',
              sale: 'Confirmed',
              done: 'Complete',
              confirmed: 'Confirmed',
              checked_in: 'Checked in',
              checked_out: 'Checked out',
              cancelled: 'Cancelled',
              no_show: 'No show',
            },
          },
          loginMissing: 'Enter your phone number or email.',
          passwordMissing: 'Enter a password.',
          nameMissing: 'Enter a display name.',
          emailMissing: 'Enter an email address.',
          emailInvalid: 'Enter a valid email address.',
          emailUsed: ['danger', 'Email already in use', 'Sign in or reset your password.'],
          signupClosed: ['warning', 'Sign-up is closed', 'Contact the shop for an account.'],
          nameInvalid: ['danger', 'That name will not do', 'Use a name of 1 to 200 characters.'],
          sent: [
            'info',
            'Request received',
            'If it matches an account with an email, a reset link is on its way and works for 30 minutes.',
          ],
          expired: [
            'danger',
            'This link no longer works',
            'It has expired or was already used. Ask for a new one.',
          ],
          reset: ['info', 'Password changed', 'Sign in with your new password.'],
          short: ['danger', 'That password will not do', 'Use 6 to 128 characters.'],
          wrongPassword: ['danger', 'The current password did not match', 'Check it and try again.'],
          saved: ['info', 'Saved', 'Your account is up to date.'],
          changed: ['info', 'Password changed', 'Your other devices are signed out.'],
          limited: ['warning', 'Too many attempts', 'Wait a few minutes and try again.'],
          failed: ['danger', 'Could not connect', 'Check your connection and try again.'],
          show: 'Show password',
          hide: 'Hide password',
          busy: 'Sending…',
        },
      }

/** A labelled input with its own error line; the script finds both by the form's field name. */
const field = (
  form: string,
  name: string,
  label: unknown,
  attributes: { type?: string; autocomplete: string; hint?: string; reveal?: string; maxLength?: number },
) => {
  const id = `wt-${form}-${name}`
  const input = html`<input type=${attributes.type ?? 'text'} name=${name} id=${id} autocomplete=${attributes.autocomplete} maxlength=${attributes.maxLength ?? (attributes.type === 'password' ? 128 : 254)} placeholder=${attributes.hint ?? ''} aria-describedby=${`${id}-error`} required>`
  return html`<label class="wt-public-signin__field"><span>${label}</span>${attributes.reveal ? html`<span class="wt-public-signin__password">${input}<button class="wt-public-signin__reveal" type="button" aria-label=${attributes.reveal} aria-pressed="false">${icon('eye')}</button></span>` : input}<small class="wt-public-signin__error" id=${`${id}-error`} hidden></small></label>`
}

/**
 * The customer's own pages, in the sign-in's card. Who is signed in, and whether a reset link
 * still works, are the customer API's to say, so the script fills the card in.
 */
const customerCard = (value: Extract<WebsitePublicListing, { kind: 'customer' }>, vi: boolean) => {
  const w = customerWords(vi)
  const notice = html`<div class="wt-public-signin__notice" role="alert" hidden><strong></strong><span></span></div>`
  const history = html`<section class="wt-public-account__history" data-customer-history="retail" hidden><h2>${w.orders}</h2><p data-history-state role="status"></p><ol data-history-list></ol><button type="button" data-history-more hidden></button></section><section class="wt-public-account__history" data-customer-history="hospitality" hidden><h2>${w.bookings}</h2><p data-history-state role="status"></p><ol data-history-list></ol><button type="button" data-history-more hidden></button></section>`
  const body =
    value.view === 'register'
      ? html`<p class="wt-public-signin__lead">${w.registerLead}</p>${notice}<form class="wt-public-signin__form" data-customer-form="register" novalidate>${field('register', 'displayName', w.displayName, { autocomplete: 'name', maxLength: 200 })}${field('register', 'email', w.emailAddress, { type: 'email', autocomplete: 'email', maxLength: 320 })}${field('register', 'password', w.newPassword, { type: 'password', autocomplete: 'new-password', reveal: w.script.show })}<button class="wt-button" type="submit">${w.registerSubmit}</button></form><div class="wt-public-signin__help"><p><strong>${w.haveAccount}</strong> <a href="/account/login">${w.signin}</a></p></div>`
      : value.view === 'forgot'
        ? html`<p class="wt-public-signin__lead">${w.forgotLead}</p>${notice}<form class="wt-public-signin__form" data-customer-form="forgot" novalidate>${field('forgot', 'login', w.login, { autocomplete: 'username', hint: w.loginHint })}<button class="wt-button" type="submit">${w.forgotSubmit}</button></form><div class="wt-public-signin__help"><p><strong>${w.noEmail[0]}</strong> ${w.noEmail[1]}</p><p><a href="/account/login">${w.backToSignin}</a></p></div>`
        : value.view === 'reset'
          ? html`<p class="wt-public-signin__lead">${w.resetLead}</p>${notice}<form class="wt-public-signin__form" data-customer-form="reset" novalidate>${field('reset', 'password', w.newPassword, { type: 'password', autocomplete: 'new-password', reveal: w.script.show })}<button class="wt-button" type="submit">${w.resetSubmit}</button></form><div class="wt-public-signin__help"><p><a href="/account/login">${w.backToSignin}</a></p><p><a href="/account/forgot">${w.askAgain}</a></p></div>`
          : html`${notice}<div data-customer-guest hidden><p class="wt-public-signin__lead">${w.guestLead}</p><a class="wt-button" href="/account/login?returnTo=%2Faccount">${w.signin}</a></div><div class="wt-public-signin__signed" data-customer-signed hidden><dl class="wt-public-account__facts"><div><dt>${w.phone}</dt><dd data-customer-fact="phone"></dd></div><div><dt>${w.email}</dt><dd data-customer-fact="email"></dd></div></dl>${history}<form class="wt-public-signin__form" data-customer-form="profile" novalidate>${field('profile', 'displayName', w.displayName, { autocomplete: 'name' })}<button class="wt-button" type="submit">${w.saveName}</button></form><h2 class="wt-public-account__heading">${w.changePassword}</h2><form class="wt-public-signin__form" data-customer-form="password" novalidate>${field('password', 'currentPassword', w.currentPassword, { type: 'password', autocomplete: 'current-password' })}${field('password', 'newPassword', w.newPassword, { type: 'password', autocomplete: 'new-password', reveal: w.script.show })}<button class="wt-button" type="submit">${w.changePassword}</button></form><div class="wt-public-signin__actions"><button class="wt-public-signin__signout" type="button">${w.signout}</button></div></div>`
  return html`<section class=${value.view === 'profile' ? 'wt-public-signin wt-public-signin--single wt-public-signin--account' : 'wt-public-signin wt-public-signin--single'} data-customer-view=${value.view} data-messages=${JSON.stringify(w.script)}><div class="wt-public-signin__panel"><div class="wt-public-signin__card"><h1>${value.title}</h1>${body}<noscript><p>${w.noscript}</p></noscript></div></div></section>`
}

const listing = (
  value: WebsitePublicListing | null,
  vi: boolean,
  brand: WebsitePublicPage['brand'],
): TemplateResult | null => {
  if (!value) return null
  if (value.kind === 'signin') return signin(value, vi, brand)
  if (value.kind === 'customer') return customerCard(value, vi)
  if (value.kind === 'embed')
    return html`<section class="wt-public-embed" data-embed-mount><h1 class="wt-public-embed__title">${value.title}</h1><div data-embed-root></div><noscript><p>${vi ? 'Cần bật JavaScript trên trình duyệt để dùng trang này.' : 'JavaScript must be enabled in your browser to use this page.'}</p></noscript></section>`
  if (value.kind === 'archive')
    return html`<section class="wt-public-archive"><h1>${value.title}</h1>${value.descriptionHtml != null ? html`<div data-ui="flow-editor-content">${trustedMarkup(value.descriptionHtml)}</div>` : value.description ? html`<p>${value.description}</p>` : null}${
      value.entries.length
        ? entryList(value.entries)
        : html`<p>${vi ? 'Chưa có bài viết.' : 'No posts yet.'}</p>`
    }${pager(value.pager, vi)}</section>`
  if (value.kind === 'search')
    return html`<section class="wt-public-search"><h1>${value.title}</h1><form role="search" action="/search" method="get"><label>${vi ? 'Từ khoá' : 'Keywords'}<input type="search" name="q" value=${value.query} maxlength="100" autocomplete="off"></label><label>${vi ? 'Loại' : 'Type'}<select name="type">${each(
      [
        ['all', vi ? 'Tất cả' : 'All'],
        ['page', vi ? 'Trang' : 'Pages'],
        ['post', vi ? 'Bài viết' : 'Posts'],
      ],
      ([type]) => String(type),
      ([type, label]) =>
        html`<option value=${type} selected=${value.type === type ? true : null}>${label}</option>`,
    )}</select></label><button type="submit">${vi ? 'Tìm' : 'Search'}</button></form>${
      !value.query
        ? null
        : value.query.length < 2
          ? html`<p>${vi ? 'Nhập ít nhất 2 ký tự.' : 'Type at least 2 characters.'}</p>`
          : html`<p role="status">${vi ? `${value.total} kết quả` : `${value.total} results`}${
              // A rebuild that has not caught up still answers; the visitor is told it may be short.
              value.stale
                ? vi
                  ? ' · Chỉ mục đang cập nhật, có thể còn thiếu kết quả.'
                  : ' · The index is updating; some results may be missing.'
                : ''
            }</p>${value.entries.length ? entryList(value.entries) : html`<p>${vi ? 'Không tìm thấy kết quả phù hợp.' : 'Nothing matched.'}</p>`}${pager(value.pager, vi)}`
    }</section>`
  // A form's receipt, after the visitor posted: the form's own thanks, the code and the time.
  return html`<section class="wt-public-receipt"><h1>${value.title}</h1><p role="status">${value.message}</p>${
    value.code
      ? html`<dl><dt>${vi ? 'Mã biên nhận' : 'Receipt'}</dt><dd><code>${value.code}</code></dd><dt>${vi ? 'Thời gian gửi' : 'Sent at'}</dt><dd><time datetime=${String(value.createdAt)}>${value.createdLabel}</time></dd></dl>`
      : null
  }<a class="wt-button" href="/">${vi ? 'Về trang chủ' : 'Back to the home page'}</a></section>`
}

// Parent links stay usable; nested lists remain available without client JavaScript.
const navigation = (items: WebsitePublicNavItem[]): TemplateResult =>
  html`<ul>${each(
    items,
    (item) => item.id,
    (item) =>
      html`<li><a href=${item.href}>${item.label}</a>${item.children ? navigation(item.children) : null}</li>`,
  )}</ul>`

/** A visitor's page of a Studio-built site. */
export function websitePublicDocument(p: WebsitePublicPage): TemplateResult {
  const vi = p.locale === 'vi'
  const searchLabel = vi ? 'Tìm kiếm' : 'Search'
  const { head, theme, siteTheme } = p
  // Shared links read Open Graph; a crawler that finds none guesses from the page.
  const openGraph = html`<meta property="og:type" content=${head.ogType}><meta property="og:title" content=${head.title}>${head.description ? html`<meta property="og:description" content=${head.description}>` : null}<meta property="og:site_name" content=${head.siteName}>${head.ogImage ? html`<meta property="og:image" content=${head.ogImage}>` : null}${head.ogUrl ? html`<meta property="og:url" content=${head.ogUrl}>` : null}`
  return html`<html lang=${p.locale}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${head.title}</title>${head.description ? html`<meta name="description" content=${head.description}>` : null}${openGraph}${head.noindex ? html`<meta name="robots" content="noindex">` : null}${head.canonical ? html`<link rel="canonical" href=${head.canonical}>` : null}<link rel="stylesheet" href="/_ket/asset/website_backend/public.css">${siteTheme ? html`<link rel="stylesheet" href=${siteTheme.stylesheet}>${siteTheme.script ? html`${trustedMarkup(`<script type="application/json" id="ket-theme-data">${siteTheme.data}</script>`)}<script type="module" src=${siteTheme.script}></script>` : null}` : null}${p.account || p.listing?.kind === 'signin' || p.listing?.kind === 'customer' ? html`<script type="module" src="/_ket/asset/website_backend/customer-account.mjs"></script>` : null}${p.listing?.kind === 'embed' ? html`${p.listing.style ? html`<link rel="stylesheet" href=${p.listing.style}>` : null}<script type="module" src=${p.listing.script}></script>` : null}</head><body class="wt-public"><div class="wt-site" data-website-theme="default" data-site-theme=${siteTheme?.key ?? null} data-theme-preset=${theme.preset} data-accent=${theme.accent} data-font=${theme.font} data-spacing=${theme.spacing} data-buttons=${theme.buttons}><header class="wt-theme-header"><a href="/">${p.brand.logo ? html`<img class="wt-public-logo" src=${p.brand.logo} alt=${p.brand.title}>` : html`<strong>${p.brand.title}</strong>`}</a><nav aria-label=${vi ? 'Điều hướng chính' : 'Main navigation'}>${navigation(p.navigation)}</nav>${p.listing?.kind === 'search' ? null : html`<form class="wt-public-search-box" role="search" action="/search" method="get"><input type="search" name="q" maxlength="100" autocomplete="off" aria-label=${searchLabel} placeholder=${searchLabel}><button type="submit">${vi ? 'Tìm' : 'Search'}</button></form>`}${p.account ? html`<a class="wt-public-account" href=${p.account.href} data-customer-account>${vi ? 'Đăng nhập' : 'Sign in'}</a>` : null}</header><main>${listing(p.listing, vi, p.brand)}${p.article ? html`<article class="wt-public-post"><h1>${p.article.title}</h1><div data-ui="flow-editor-content">${trustedMarkup(p.article.bodyHtml)}</div></article>` : null}${p.sections}</main><footer class="wt-theme-footer">${p.footer}</footer></div></body></html>`
}

/** The empty page the Studio client mounts into; `props` is its serialized starting state. */
export function websiteStudioDocument(props: string): TemplateResult {
  return html`<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Website · KétSuite</title><link rel="stylesheet" href="/_ket/asset/website_backend/website.css"><script type="module" src="/_ket/asset/website_backend/website.mjs"></script></head><body style="margin:0"><div data-kv-design-system data-theme="light" data-presentation="grouped" data-density="compact"><div id="website-studio" data-props=${props}></div></div></body></html>`
}
