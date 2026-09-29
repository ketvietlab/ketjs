// Notifications between the code that changes something and the connections
// waiting to hear that it changed.
//
// A notification is a hint, never the data: it names what moved so a listener
// knows what to re-read through the usual, authorized path. That is what makes
// it safe to lose one — the reader polls as well, only less often — and why the
// payload is small enough for PostgreSQL's NOTIFY (under 8000 bytes).
//
// The hub is per database and per process. However many sockets are waiting on
// a channel, the database sees one LISTEN for it, and every message is fanned
// out here. Without it each open socket would hold a listener of its own, and
// the number of sockets a server can keep would be the number of connections
// its database allows.

import type { Adapter } from '../types.ts'

/** The largest payload PostgreSQL delivers; a longer one fails the transaction. */
export const NOTIFY_PAYLOAD_BYTES = 7_999
const CHANNEL = /^[a-z_][a-z0-9_]{0,62}$/

export type NotificationHub = {
  /**
   * True when the database carries notifications between processes. False —
   * SQLite — they reach listeners in this process only, which is every listener
   * when the web server is the only process, and none in a separate worker.
   */
  readonly shared: boolean
  /**
   * Listen on a channel. `onReady` runs once listening has started and again
   * after the database connection was lost and re-established, because anything
   * published in the gap was missed and should be re-read.
   */
  subscribe(
    channel: string,
    onMessage: (payload: string) => void,
    onReady?: () => void,
  ): Promise<() => Promise<void>>
  /** Deliver to this process's listeners only. What a publish becomes without a shared bus. */
  deliverLocally(channel: string, payload: string): void
}

export function checkNotification(channel: string, payload: string): void {
  if (!CHANNEL.test(channel))
    throw new TypeError(
      `notification channel "${channel}" must be a lowercase identifier of at most 63 characters`,
    )
  if (Buffer.byteLength(payload) > NOTIFY_PAYLOAD_BYTES)
    throw new RangeError(
      `a notification payload is at most ${NOTIFY_PAYLOAD_BYTES} bytes; send an id, not the data`,
    )
}

type Listener = { onMessage: (payload: string) => void; onReady?: () => void; told?: boolean }
type Channel = {
  listeners: Set<Listener>
  ready: boolean
  started: Promise<() => Promise<void>> | null
}

const hubs = new WeakMap<Adapter, NotificationHub>()

/** The hub for a root adapter. Transaction adapters publish; only a root listens. */
export function notificationHub(adapter: Adapter): NotificationHub {
  let hub = hubs.get(adapter)
  if (!hub) {
    hub = createHub(adapter)
    hubs.set(adapter, hub)
  }
  return hub
}

function createHub(adapter: Adapter): NotificationHub {
  const database = adapter.notifications?.subscribe ? adapter.notifications : null
  const channels = new Map<string, Channel>()

  const each = (entry: Channel, call: (listener: Listener) => void): void => {
    for (const listener of [...entry.listeners]) {
      // One listener throwing must not cost the others their message.
      try {
        call(listener)
      } catch {}
    }
  }

  return {
    shared: database !== null,
    async subscribe(channel, onMessage, onReady) {
      checkNotification(channel, '')
      let entry = channels.get(channel)
      if (!entry) {
        entry = { listeners: new Set(), ready: database === null, started: null }
        channels.set(channel, entry)
      }
      const listener: Listener = { onMessage, ...(onReady ? { onReady } : {}) }
      entry.listeners.add(listener)
      const current = entry
      if (database && !current.started) {
        current.started = (database.subscribe as NonNullable<typeof database.subscribe>)(
          channel,
          (payload) => each(current, (l) => l.onMessage(payload)),
          () => {
            current.ready = true
            each(current, (l) => {
              l.told = true
              l.onReady?.()
            })
          },
        )
        current.started.catch(() => {
          if (channels.get(channel) === current) channels.delete(channel)
        })
      }
      try {
        await current.started
      } catch (error) {
        current.listeners.delete(listener)
        throw error
      }
      // Joining a channel that was already listening: its ready has been and gone.
      if (current.ready && onReady && !listener.told)
        queueMicrotask(() => {
          if (!current.listeners.has(listener) || listener.told) return
          listener.told = true
          onReady()
        })
      let left = false
      return async () => {
        if (left) return
        left = true
        current.listeners.delete(listener)
        if (current.listeners.size || channels.get(channel) !== current) return
        channels.delete(channel)
        const stop = await current.started?.catch(() => null)
        await stop?.()
      }
    },
    deliverLocally(channel, payload) {
      const entry = channels.get(channel)
      if (!entry) return
      // Never inside the publisher's call: a listener that writes must not run
      // in the middle of the write that told it to.
      queueMicrotask(() => each(entry, (l) => l.onMessage(payload)))
    },
  }
}
