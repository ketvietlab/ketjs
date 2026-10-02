// The customer sign-in on a Studio site's public pages: the header's account link and the sign-in
// page. No framework and no dependency - it ships to visitors, not to the Studio. The words it shows
// come from the page, already in the site's language.

const API = '/api/customer/v1'
// Survives the reload that follows signing out, so the page can say it happened.
const SIGNED_OUT = 'ket-customer-signed-out'

type Customer = { displayName?: string | null; email?: string | null; phone?: string | null }
type Envelope<T> = { data?: T; error?: { message?: string } }
type Session = { customer: Customer | null; csrfToken: string | null }
type Notice = [tone: string, title: string, text: string]
type Messages = {
  loginMissing: string
  passwordMissing: string
  invalid: Notice
  limited: Notice
  failed: Notice
  signedOut: Notice
  show: string
  hide: string
  busy: string
}

const call = async <T>(path: string, init: RequestInit = {}) => {
  const response = await fetch(`${API}/${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'accept-language': document.documentElement.lang || 'vi',
      ...(init.headers as Record<string, string> | undefined),
    },
  })
  const body = (await response.json().catch(() => ({}))) as Envelope<T>
  return { status: response.status, body }
}

const nameOf = (customer: Customer): string =>
  customer.displayName?.trim() || customer.phone || customer.email || ''

const session = async (): Promise<Session> => {
  try {
    const { body } = await call<Session>('bootstrap')
    return { customer: body.data?.customer ?? null, csrfToken: body.data?.csrfToken ?? null }
  } catch {
    return { customer: null, csrfToken: null }
  }
}

/** A signed-in visitor sees their name where the header offered to sign in. */
const header = (customer: Customer | null) => {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-customer-account]')) {
    if (!customer) continue
    link.textContent = nameOf(customer)
    link.dataset.signedIn = ''
  }
}

/** Only a path on this site; the page already checked it, and a script that navigates checks again. */
const sameSite = (path: string | undefined): string =>
  path && /^\/(?![/\\])/.test(path) && !path.includes('\\') ? path : '/'

const remember = (key: string, value: string | null) => {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    /* A browser that keeps nothing simply does not say it. */
  }
}
const recall = (key: string) => {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

const signin = (root: HTMLElement, current: Session) => {
  const form = root.querySelector<HTMLFormElement>('.wt-public-signin__form')
  const notice = root.querySelector<HTMLElement>('.wt-public-signin__notice')
  const signed = root.querySelector<HTMLElement>('.wt-public-signin__signed')
  const name = root.querySelector<HTMLElement>('[data-customer-name]')
  const signout = root.querySelector<HTMLButtonElement>('.wt-public-signin__signout')
  const reveal = root.querySelector<HTMLButtonElement>('.wt-public-signin__reveal')
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]')
  const login = form?.querySelector<HTMLInputElement>('input[name="login"]')
  const password = form?.querySelector<HTMLInputElement>('input[name="password"]')
  if (!form || !notice || !signed || !name || !signout || !submit || !login || !password) return
  const returnTo = sameSite(root.dataset.returnTo)
  let words: Messages
  try {
    words = JSON.parse(root.dataset.messages ?? '') as Messages
  } catch {
    return
  }

  const show = (customer: Customer | null) => {
    for (const part of root.querySelectorAll<HTMLElement>('[data-signin-guest]')) part.hidden = !!customer
    signed.hidden = !customer
    name.textContent = customer ? nameOf(customer) : ''
  }
  const say = (message: Notice | null) => {
    notice.hidden = !message
    notice.dataset.tone = message?.[0] ?? ''
    notice.querySelector('strong')!.textContent = message?.[1] ?? ''
    notice.querySelector('span')!.textContent = message?.[2] ?? ''
  }
  /** One field's own complaint, under it and named by it to a screen reader. */
  const flag = (input: HTMLInputElement, message: string) => {
    const error = document.getElementById(input.getAttribute('aria-describedby') ?? '')
    if (message) input.setAttribute('aria-invalid', 'true')
    else input.removeAttribute('aria-invalid')
    if (error) {
      error.textContent = message
      error.hidden = !message
    }
  }
  for (const input of [login, password]) input.addEventListener('input', () => flag(input, ''))

  show(current.customer)
  if (recall(SIGNED_OUT) && !current.customer) say(words.signedOut)
  remember(SIGNED_OUT, null)

  reveal?.addEventListener('click', () => {
    const visible = password.type === 'password'
    password.type = visible ? 'text' : 'password'
    reveal.setAttribute('aria-pressed', String(visible))
    reveal.setAttribute('aria-label', visible ? words.hide : words.show)
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const who = login.value.trim()
    flag(login, who ? '' : words.loginMissing)
    flag(password, password.value ? '' : words.passwordMissing)
    if (!who || !password.value) {
      say(null)
      ;(who ? password : login).focus()
      return
    }
    const label = submit.textContent
    submit.disabled = true
    submit.setAttribute('aria-busy', 'true')
    submit.textContent = words.busy
    say(null)
    try {
      // One field, two keys: an address has an @, anything else is read as a phone number.
      const { status, body } = await call<{ customer?: Customer }>('auth/session/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          who.includes('@')
            ? { email: who, password: password.value }
            : { phone: who, password: password.value },
        ),
      })
      if (status === 200 && body.data?.customer) {
        location.assign(returnTo)
        return
      }
      // The API's own wording names only the email, and this field also takes a phone number.
      say(status === 401 ? words.invalid : status === 429 ? words.limited : words.failed)
      password.value = ''
      password.focus()
    } catch {
      say(words.failed)
    }
    submit.disabled = false
    submit.removeAttribute('aria-busy')
    submit.textContent = label
  })

  signout.addEventListener('click', async () => {
    signout.disabled = true
    try {
      const { status } = await call('auth/logout', {
        method: 'POST',
        headers: current.csrfToken ? { 'x-csrf-token': current.csrfToken } : {},
      })
      // Signed out already - an expired session - is the outcome the visitor asked for.
      if (status === 200 || status === 401) {
        remember(SIGNED_OUT, '1')
        location.reload()
        return
      }
    } catch {
      /* Said below. */
    }
    signout.disabled = false
    say(words.failed)
  })
}

const start = async () => {
  const root = document.querySelector<HTMLElement>('[data-customer-signin]')
  if (!root && !document.querySelector('[data-customer-account]')) return
  const current = await session()
  header(current.customer)
  if (root) signin(root, current)
}

void start()
