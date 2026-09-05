// The two things every audit timeline has to get right, and neither of which is
// about what an event means.
//
// What an event *is* — a subject, an action, which configuration and session it
// happened in — belongs to the domain, and a framework that modelled it would be
// modelling somebody's compliance regime. What the framework can own is the part
// both existing timelines had to invent for themselves: an identity that survives
// a retry, and a digest that does not carry the value it stands for.

import { createHash } from 'node:crypto'
import { KetError } from './errors.ts'

const NAMESPACE = /^[a-z][a-z0-9_]*$/

const namespaced = (namespace: string): string => {
  if (!NAMESPACE.test(namespace)) {
    throw new KetError({
      code: 'E_AUDIT_NAMESPACE',
      message: `"${namespace}" is not an audit namespace`,
      hint: 'use the owning module name, so two modules cannot collide or test each other values',
    })
  }
  return namespace
}

/**
 * A digest that stands for an identity without carrying it.
 *
 * Namespaced by the owning module for two reasons: two modules hashing the same
 * customer id produce different digests, so one timeline cannot be joined to
 * another by accident; and a digest from one module cannot be tested against a
 * guess made in the context of another.
 *
 * This is pseudonymisation, not secrecy. A low-entropy value — an order number, a
 * short code — remains guessable by anyone who can run the same hash, so it keeps
 * a value out of a row rather than out of reach. Where the row leaves the tenant,
 * hash something with entropy or key it.
 */
export function auditHash(namespace: string, kind: string, value: unknown): string | null {
  const held = String(value ?? '').trim()
  if (!held) return null
  return createHash('sha256')
    .update(`${namespaced(namespace)}:${kind}\n${held}`)
    .digest('hex')
}

/**
 * An identity derived from the command, so a retry lands on the row it already wrote.
 *
 * A command that is retried must not produce a second event, and the only way to
 * know it is the same command is to derive the id from the same parts. Combined
 * with `insertIfAbsent` on an append-only model, a replay becomes a no-op rather
 * than a duplicate — which is what both existing timelines do by hand.
 *
 * Parts are joined with a separator they cannot contain, so ["a", "b:c"] and
 * ["a:b", "c"] are different commands rather than the same one.
 */
export function auditId(namespace: string, parts: readonly string[]): string {
  if (!parts.length) {
    throw new KetError({
      code: 'E_AUDIT_ID',
      message: 'an audit id needs at least one part of the command identity',
      hint: 'pass what makes this command that command — its key, its subject, its action',
    })
  }
  const canonical = parts.map((part) => String(part ?? '')).join('\n')
  return createHash('sha256')
    .update(`${namespaced(namespace)}:event\n${canonical}`)
    .digest('hex')
}
