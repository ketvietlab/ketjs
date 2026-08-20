// @ts-nocheck This dependency-free browser/SSR source is contract-tested through both runtimes.
const LABELS = {
  vi: {
    title: 'Thảo luận',
    followers: 'người theo dõi',
    follow: 'Theo dõi',
    unfollow: 'Bỏ theo dõi',
    comment: 'Gửi tin nhắn',
    note: 'Ghi chú nội bộ',
    placeholder: 'Viết cập nhật cho bản ghi này…',
    attachment: 'Tệp đính kèm',
    send: 'Gửi',
    sending: 'Đang gửi…',
    close: 'Đóng',
    loading: 'Đang tải trao đổi…',
    empty: 'Chưa có trao đổi nào.',
    loadMore: 'Tải thêm',
    retry: 'Thử lại',
    system: 'KetSuite',
    inbox: 'Hộp thư thông báo',
    email: 'Email',
    deliveryStates: {
      queued: 'đang chờ',
      sending: 'đang gửi',
      retryable: 'chờ thử lại',
      sent: 'đã gửi',
      failed: 'gửi lỗi',
      cancelled: 'đã hủy',
    },
  },
  en: {
    title: 'Chatter',
    followers: 'followers',
    follow: 'Follow',
    unfollow: 'Unfollow',
    comment: 'Send message',
    note: 'Internal note',
    placeholder: 'Write an update for this record…',
    attachment: 'Attachment',
    send: 'Send',
    sending: 'Sending…',
    close: 'Close',
    loading: 'Loading conversation…',
    empty: 'No messages yet.',
    loadMore: 'Load more',
    retry: 'Retry',
    system: 'KetSuite',
    inbox: 'Notification inbox',
    email: 'Email',
    deliveryStates: {
      queued: 'queued',
      sending: 'sending',
      retryable: 'retry pending',
      sent: 'sent',
      failed: 'failed',
      cancelled: 'cancelled',
    },
  },
}

const labelsOf = (props) => LABELS[String(props.lang).toLowerCase().startsWith('en') ? 'en' : 'vi']
const localeOf = (props) => (String(props.lang).toLowerCase().startsWith('en') ? 'en-US' : 'vi-VN')

const apiFor = (resModel) => {
  if (resModel === 'product.Template') return 'product_mail_backend'
  if (resModel === 'stock.Picking') return 'stock_mail_backend'
  return null
}

const errorText = (error) =>
  error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : 'The collaboration request failed'

const callApi = async (name, input) => {
  const response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false) {
    const error = new Error(String(payload.message ?? `HTTP ${response.status}`))
    error.code = payload.code
    throw error
  }
  return payload.value
}

const upload = async (file, messageId) => {
  const form = new FormData()
  form.set('file', file)
  form.set('resModel', 'mail.Message')
  form.set('resId', messageId)
  const response = await fetch('/files', { method: 'POST', credentials: 'same-origin', body: form })
  const payload = await response.json()
  if (!response.ok) throw new Error(String(payload.message ?? `HTTP ${response.status}`))
  return String(payload.id)
}

export function createChatterView(runtime, props, seed = {}) {
  const { each, html, signal } = runtime
  const labels = labelsOf(props)
  const status = signal(seed.status ?? 'loading')
  const busy = signal(false)
  const composerKind = signal(seed.composerKind ?? null)
  const error = signal(seed.error ?? '')
  const page = signal(
    seed.page ?? {
      threadId: null,
      displayName: '',
      total: 0,
      messages: [],
      followers: [],
      following: false,
    },
  )
  const bridge = apiFor(String(props.resModel))
  let pollCount = 0

  const load = async ({ append = false, quiet = false } = {}) => {
    if (!bridge) {
      status.set('error')
      error.set(`Unsupported collaboration target: ${String(props.resModel)}`)
      return
    }
    if (!quiet) status.set('loading')
    try {
      const current = page()
      const result = await callApi(`${bridge}.timeline`, {
        targetId: props.resId,
        limit: append ? 20 : Math.max(20, current.messages.length),
        offset: append ? current.messages.length : 0,
      })
      page.set(append ? { ...result, messages: [...current.messages, ...result.messages] } : result)
      error.set('')
      status.set('ready')
    } catch (cause) {
      error.set(errorText(cause))
      status.set('error')
    }
  }

  const post = async (event) => {
    event.preventDefault()
    if (!bridge || busy()) return
    const form = event.target
    const values = new FormData(form)
    const body = String(values.get('body') ?? '').trim()
    if (!body) return
    busy.set(true)
    error.set('')
    try {
      const id = crypto.randomUUID()
      const selected = values.get('attachment')
      const attachmentIds = selected instanceof File && selected.size > 0 ? [await upload(selected, id)] : []
      await callApi(`${bridge}.post`, {
        id,
        targetId: props.resId,
        kind: String(values.get('kind') ?? 'comment'),
        body,
        attachmentIds,
      })
      form.reset()
      await load()
      composerKind.set(null)
    } catch (cause) {
      error.set(errorText(cause))
      status.set('error')
    } finally {
      busy.set(false)
    }
  }

  const toggleFollow = async () => {
    if (!bridge || busy()) return
    busy.set(true)
    try {
      await callApi(`${bridge}.${page().following ? 'unfollow' : 'follow'}`, { targetId: props.resId })
      await load({ quiet: true })
    } catch (cause) {
      error.set(errorText(cause))
      status.set('error')
    } finally {
      busy.set(false)
    }
  }

  const schedulePoll = () => {
    if (pollCount >= 240) return
    pollCount++
    setTimeout(async () => {
      if (document.visibilityState === 'visible' && !busy()) await load({ quiet: true })
      schedulePoll()
    }, 15_000)
  }

  if (typeof window !== 'undefined')
    queueMicrotask(async () => {
      await load()
      schedulePoll()
    })

  return () => {
    const data = page()
    return html`<section data-ui="chatter" data-state=${status()} aria-label=${labels.title}>
      <div data-ui="chatter-kinds" role="toolbar" aria-label=${labels.title}>
        <button data-ui="chatter-kind" data-kind="comment" data-active=${composerKind() === 'comment'} data-control="action" data-variant="secondary" data-size="compact" type="button" aria-pressed=${composerKind() === 'comment'} on:click=${() => composerKind.set(composerKind() === 'comment' ? null : 'comment')} disabled=${busy()}>${labels.comment}</button>
        <button data-ui="chatter-kind" data-kind="note" data-active=${composerKind() === 'note'} data-control="action" data-variant="secondary" data-size="compact" type="button" aria-pressed=${composerKind() === 'note'} on:click=${() => composerKind.set(composerKind() === 'note' ? null : 'note')} disabled=${busy()}>${labels.note}</button>
      </div>
      <header data-ui="chatter-head">
        <div data-ui="chatter-heading">
          <h2 data-ui="chatter-title">${labels.title}</h2>
          <span data-ui="chatter-followers">${data.followers.length} ${labels.followers}</span>
        </div>
        <button data-ui="chatter-follow" data-control="action" data-variant="secondary" data-size="compact" type="button" on:click=${toggleFollow} disabled=${busy()}>
          ${data.following ? labels.unfollow : labels.follow}
        </button>
      </header>
      ${composerKind() ? html`<form data-ui="chatter-composer" on:submit=${post}>
        <input type="hidden" name="kind" value=${composerKind()}>
        <textarea data-ui="chatter-body" name="body" placeholder=${labels.placeholder} required disabled=${busy()}></textarea>
        <div data-ui="chatter-compose-actions">
          <label data-ui="chatter-attachment">${labels.attachment}<input type="file" name="attachment" disabled=${busy()}></label>
          <div>
            <button data-ui="chatter-compose-close" data-control="action" data-variant="tertiary" data-size="compact" type="button" on:click=${() => composerKind.set(null)} disabled=${busy()}>${labels.close}</button>
            <button data-ui="chatter-send" data-control="action" data-variant="primary" data-size="compact" type="submit" disabled=${busy()}>${busy() ? labels.sending : labels.send}</button>
          </div>
        </div>
      </form>` : ''}
      ${error() ? html`<div data-ui="chatter-error" role="alert">${error()} <button data-ui="action" data-variant="secondary" data-size="compact" type="button" on:click=${() => load()}>${labels.retry}</button></div>` : ''}
      <div data-ui="chatter-timeline" aria-live="polite">
        ${status() === 'loading' ? html`<p data-ui="chatter-loading">${labels.loading}</p>` : ''}
        ${status() === 'ready' && data.messages.length === 0 ? html`<p data-ui="chatter-empty">${labels.empty}</p>` : ''}
        ${each(
          data.messages,
          (message) => message.id,
          (message) => html`<article data-ui="chatter-message" data-kind=${message.kind}>
            <header data-ui="chatter-message-head">
              <strong data-ui="chatter-author">${message.authorName || labels.system}</strong>
              <time data-ui="chatter-time" datetime=${message.createdAt}>${new Date(message.createdAt).toLocaleString(localeOf(props))}</time>
            </header>
            <p data-ui="chatter-message-body">${message.body}</p>
            ${
              message.deliveries?.length
                ? html`<ul data-ui="chatter-deliveries">${each(
                    message.deliveries,
                    (delivery) => delivery.id,
                    (delivery) => html`<li data-ui="chatter-delivery" data-state=${delivery.state}>
                      ${labels.email}: ${labels.deliveryStates[delivery.state] ?? delivery.state}
                      ${delivery.state === 'failed' && delivery.lastError ? html`<span>${delivery.lastError}</span>` : ''}
                    </li>`,
                  )}</ul>`
                : ''
            }
            ${
              message.attachments?.length
                ? html`<ul data-ui="chatter-attachments">${each(
                    message.attachments,
                    (attachment) => attachment.id,
                    (attachment) => html`<li><a href=${attachment.href}>${attachment.name}</a></li>`,
                  )}</ul>`
                : ''
            }
          </article>`,
        )}
      </div>
      ${
        data.messages.length < data.total
          ? html`<button data-ui="chatter-more" data-control="action" data-variant="secondary" data-size="compact" type="button" on:click=${() => load({ append: true })} disabled=${busy()}>${labels.loadMore}</button>`
          : ''
      }
    </section>`
  }
}

export function createInboxIndicatorView(runtime, props, initialCount = 0) {
  const { html, signal } = runtime
  const labels = labelsOf(props)
  const count = signal(initialCount)
  const load = async () => {
    try {
      const result = await callApi('mail.countUnread', {})
      count.set(Number(result.count ?? 0))
    } catch {
      count.set(0)
    }
  }
  if (typeof window !== 'undefined') queueMicrotask(load)
  return () => html`<a data-ui="mail-indicator" href="/admin/inbox" title=${labels.inbox} aria-label=${labels.inbox}>
    <svg data-ui="mail-indicator-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-3.8A4 4 0 0 1 1 15V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4Z" />
    </svg>
    ${count() > 0 ? html`<span data-ui="mail-indicator-count">${count()}</span>` : ''}
  </a>`
}
