// What a route is allowed to return.
//
// The problem this closes: `body` used to be a `string`, so a value that had been
// through the escaper and a value someone concatenated by hand were the same type.
// Nothing could tell them apart — not the compiler, not a reviewer skimming a diff.
// The document shell was concatenation for exactly that reason: it was allowed.
//
// So RouteResult is branded. The brand is a type-only symbol, erased at runtime,
// which means the shape is unforgeable in TypeScript without saying so: a route
// cannot return `{ body: '<div>' + name }` because that object is not a
// RouteResult. The only ways to make one are below, and the only one that accepts
// a string is `raw`, which is one word to grep for and one word to argue about in
// review. `bytes` and `streamed` carry octets rather than a string, and they refuse
// markup content types so that the same claim holds for them.

import { renderToString, html, when, each } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import type { IncomingMessage } from 'node:http'

/** Markup that has been through the escaper. The only thing that may become HTML. */
export type Html = TemplateResult
export type ResponseBody = string | Uint8Array | AsyncIterable<Uint8Array>
export const NAVIGATION_HEADER = 'x-ket-navigation'
export const NAVIGATION_VERSION = 'fragment-v1'
export const NAVIGATION_TYPE = 'text/vnd.ket.fragments+html'

declare const RESPONSE: unique symbol
export type RouteResult = {
  status?: number
  type?: string
  body: ResponseBody
  /** Extra response headers. A cookie is the reason this exists. */
  headers?: Record<string, string>
  readonly [RESPONSE]: true
}

const made = (body: ResponseBody, type: string, status?: number): RouteResult =>
  ({ body, type, ...(status === undefined ? {} : { status }) }) as RouteResult

/**
 * A whole document. `<!doctype html>` is a constant rather than a hole, which is
 * why it can be prepended: there is nothing to escape in it.
 */
export function page(o: { body: Html; status?: number }): RouteResult {
  return made('<!doctype html>' + renderToString(o.body), 'text/html', o.status)
}

/** A fragment: no doctype, for a partial response or an island. */
export function fragment(body: Html, o: { status?: number; type?: string } = {}): RouteResult {
  return made(renderToString(body), o.type ?? 'text/html', o.status)
}

/** Whether this browser asks for the progressive-navigation representation. */
export function isNavigationRequest(req: Pick<IncomingMessage, 'headers'>): boolean {
  return req.headers[NAVIGATION_HEADER] === NAVIGATION_VERSION
}

/**
 * Serve either the full document or only its named, replaceable slot bodies.
 * Thunks are deliberate: an island outside the selected representation is never
 * constructed merely to be thrown away by the browser.
 */
export function navigablePage(
  req: Pick<IncomingMessage, 'headers'>,
  o: {
    title: string
    document: () => Html
    slots: Record<string, () => Html>
    status?: number
  },
): RouteResult {
  const vary = { vary: 'X-Ket-Navigation' }
  if (!isNavigationRequest(req)) return withHeaders(page({ body: o.document(), status: o.status }), vary)

  const entries = Object.entries(o.slots)
  for (const [name] of entries) {
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(name))
      throw new TypeError(`navigation slot "${name}" must be a lowercase dotted name`)
  }
  const body = html`<ket-fragments data-title=${o.title}>${each(
    entries,
    ([name]) => name,
    ([name, render]) => html`<template data-ket-slot=${name}>${render()}</template>`,
  )}</ket-fragments>`
  return withHeaders(made(renderToString(body), NAVIGATION_TYPE, o.status), vary)
}

export function json(value: unknown, o: { status?: number } = {}): RouteResult {
  return made(JSON.stringify(value, null, 2), 'application/json', o.status)
}

export function text(body: string, o: { type?: string; status?: number } = {}): RouteResult {
  return made(body, o.type ?? 'text/plain', o.status)
}

/** Octets are not markup, and these two keep it that way; raw() remains the one word to grep for. */
const octets = (type: string): string => {
  if (/^\s*(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)\b/i.test(type))
    throw new Error(`bytes()/streamed() will not serve "${type}"; use raw() if markup is intended`)
  return type
}

/** Binary data already resident in memory. Unlike raw(), it can never become HTML by accident. */
export function bytes(body: Uint8Array, o: { type: string; status?: number }): RouteResult {
  return made(body, octets(o.type), o.status)
}

/** A backpressure-aware binary response; the HTTP layer consumes it chunk by chunk. */
export function streamed(body: AsyncIterable<Uint8Array>, o: { type: string; status?: number }): RouteResult {
  return made(body, octets(o.type), o.status)
}

/**
 * The escape hatch, deliberately named so a search finds every use.
 *
 * Reach for it when the bytes did not come from the escaper and cannot: a sitemap
 * assembled by a library, a cached response, markup from a source you have already
 * decided to trust. Never for a value that came from a request.
 */
export function raw(body: string, o: { type?: string; status?: number } = {}): RouteResult {
  return made(body, o.type ?? 'text/html', o.status)
}

/**
 * Add headers to a response without rebuilding it, and without spreading — a
 * spread would produce a plain object that only looks like a RouteResult, which
 * is exactly the hole the brand exists to close.
 */
export function withHeaders(result: RouteResult, headers: Record<string, string>): RouteResult {
  return { ...result, headers: { ...result.headers, ...headers } } as RouteResult
}

/**
 * The document every screen sits in, as markup rather than as a string.
 *
 * `lang` reaches the first attribute on the page, which is where i18n starts and
 * where the old concatenated shell put whatever the query string said.
 */
export function document(o: { lang: string; title?: string; head?: Html; body: Html }): Html {
  return html`<html lang=${o.lang}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${when(
    o.title !== undefined,
    () => html`<title>${o.title}</title>`,
  )}${o.head ?? ''}</head><body>${o.body}</body></html>`
}
