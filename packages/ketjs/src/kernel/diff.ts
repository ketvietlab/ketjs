// Upgrade diff — the thing the domain contract, WordPress and Shopify structurally cannot do.
//
// Because the manifest records every joint, field and signature with provenance,
// two manifests can be compared and every downstream breakage named BEFORE deploy
// rather than discovered at 3am after an upgrade.

import type { Manifest } from '../types.ts'

export type Severity = 'breaking' | 'risky' | 'safe'
export type DiffItem = { severity: Severity; code: string; message: string; hint?: string }

export function diffManifests(before: Manifest, after: Manifest): DiffItem[] {
  const out: DiffItem[] = []
  const push = (severity: Severity, code: string, message: string, hint?: string) =>
    out.push({ severity, code, message, hint })

  for (const key of Object.keys(before.joints)) {
    if (after.joints[key]) continue
    const users = after.fills.filter((f) => f.joint === key).map((f) => f.by)
    push(
      'breaking',
      'JOINT_REMOVED',
      `joint "${key}" was removed`,
      users.length ? `still filled by: ${users.join(', ')}` : 'no composed module fills it - safe to proceed',
    )
  }

  for (const [mkey, bmodel] of Object.entries(before.models)) {
    const amodel = after.models[mkey]
    if (amodel && amodel.scope !== bmodel.scope) {
      push(
        'breaking',
        'MODEL_SCOPE_CHANGED',
        `model "${mkey}" moved from ${bmodel.scope} to ${amodel.scope}`,
        'existing rows carry the old shape; widening leaks and narrowing hides data',
      )
    }
    if (!amodel) {
      const extenders = new Set(
        Object.values(bmodel.fields)
          .filter((f) => f.by !== bmodel.owner)
          .map((f) => f.by),
      )
      push(
        'breaking',
        'MODEL_REMOVED',
        `model "${mkey}" was removed`,
        extenders.size ? `extended by: ${[...extenders].join(', ')}` : 'no module extends it',
      )
      continue
    }
    for (const [fname, f] of Object.entries(bmodel.fields)) {
      const af = amodel.fields[fname]
      if (!af) {
        const readers = Object.entries(after.views)
          .filter(([, v]) => v.of === mkey && v.fields.includes(fname))
          .map(([k]) => k)
        push(
          'breaking',
          'FIELD_REMOVED',
          `field "${mkey}.${fname}" (contributed by ${f.by}) was removed`,
          readers.length
            ? `read by view(s): ${readers.join(', ')} - data loss on migrate`
            : 'no view reads it, but existing rows lose the column',
        )
      } else if (af.base !== f.base || af.target !== f.target) {
        push(
          'breaking',
          'FIELD_TYPE_CHANGED',
          `field "${mkey}.${fname}" changed ${f.base} -> ${af.base}`,
          'write an explicit data migration',
        )
      } else if (f.optional && !af.optional) {
        push(
          'risky',
          'FIELD_NOW_REQUIRED',
          `field "${mkey}.${fname}" became required`,
          'existing NULL rows violate it - backfill first',
        )
      } else if (Boolean(f.sensitive) !== Boolean(af.sensitive)) {
        push(
          'risky',
          'FIELD_SENSITIVITY_CHANGED',
          `field "${mkey}.${fname}" is ${af.sensitive ? 'now' : 'no longer'} sensitive`,
          af.sensitive
            ? 'values already written to write records and idempotency rows are not masked retroactively'
            : 'its values will now reach write records, the agent descriptor and dry-run previews',
        )
      } else if (Boolean(f.personal) !== Boolean(af.personal)) {
        push(
          'risky',
          'FIELD_CLASSIFICATION_CHANGED',
          `field "${mkey}.${fname}" is ${af.personal ? 'now' : 'no longer'} personal data`,
          af.personal
            ? 'existing rows are in scope for export and erasure from this version on'
            : 'check that the obligation really ended rather than the declaration being dropped',
        )
      }
    }
  }

  for (const [fkey, bfn] of Object.entries(before.functions)) {
    const afn = after.functions[fkey]
    if (!afn) {
      push(
        'breaking',
        'FUNCTION_REMOVED',
        `server function "${fkey}" was removed`,
        'callers and agent tools break',
      )
      continue
    }
    for (const arg of Object.keys(bfn.input)) {
      if (!(arg in afn.input)) push('breaking', 'INPUT_REMOVED', `"${fkey}" no longer accepts input "${arg}"`)
    }
    for (const [arg, t] of Object.entries(afn.input)) {
      if (!(arg in bfn.input) && !t.endsWith('?')) {
        push(
          'breaking',
          'INPUT_ADDED_REQUIRED',
          `"${fkey}" gained required input "${arg}"`,
          `make it optional ("${t}?") to stay compatible`,
        )
      }
    }
    if (bfn.idempotent && !afn.idempotent)
      push(
        'risky',
        'IDEMPOTENCY_LOST',
        `"${fkey}" is no longer idempotent`,
        'agent retries may double-apply it',
      )
    if (bfn.exposure === 'http' && afn.exposure === 'internal')
      push(
        'breaking',
        'FUNCTION_HTTP_REMOVED',
        `server function "${fkey}" is no longer exposed over generic HTTP`,
        'move callers behind the trusted route that owns this internal function',
      )
    if (!bfn.crossCompany && afn.crossCompany) {
      push(
        'risky',
        'CROSS_COMPANY_GAINED',
        `"${fkey}" now reads across legal entities`,
        'the company filter no longer applies to it — confirm that is intended',
      )
    }
  }

  for (const [key, job] of Object.entries(before.jobs ?? {})) {
    const next = after.jobs?.[key]
    if (!next) {
      push(
        'breaking',
        'JOB_REMOVED',
        `background job "${key}" was removed`,
        'pending records will be discarded instead of running stale code',
      )
      continue
    }
    for (const arg of Object.keys(job.input)) {
      if (!(arg in next.input))
        push('breaking', 'JOB_INPUT_REMOVED', `"${key}" no longer accepts input "${arg}"`)
    }
    for (const [arg, type] of Object.entries(next.input)) {
      if (!(arg in job.input) && !type.endsWith('?'))
        push(
          'breaking',
          'JOB_INPUT_ADDED_REQUIRED',
          `"${key}" gained required input "${arg}"`,
          'already-enqueued records do not carry it',
        )
    }
    if (job.queue !== next.queue)
      push(
        'risky',
        'JOB_QUEUE_CHANGED',
        `"${key}" moved from queue "${job.queue}" to "${next.queue}"`,
        `existing records remain in "${job.queue}" until drained or retried`,
      )
  }

  for (const [key, report] of Object.entries(before.reports ?? {})) {
    const next = after.reports?.[key]
    if (!next) {
      push(
        'breaking',
        'REPORT_REMOVED',
        `report "${key}" was removed`,
        'saved templates and print actions no longer resolve',
      )
      continue
    }
    if (report.target !== next.target)
      push(
        'breaking',
        'REPORT_TARGET_CHANGED',
        `report "${key}" moved from ${report.target} to ${next.target}`,
      )
    if (report.source !== next.source)
      push(
        'risky',
        'REPORT_SOURCE_CHANGED',
        `report "${key}" changed source from ${report.source} to ${next.source}`,
      )
  }

  for (const r of Object.keys(before.regions.provided)) {
    if (!after.regions.provided[r] && after.regions.required.includes(r)) {
      push('breaking', 'REGION_LOST', `region "${r}" is no longer provided by any theme`)
    }
  }

  for (const p of after.patches) {
    push(
      'risky',
      'UNSAFE_PATCH',
      `module "${p.by}" unsafe-patches "${p.target}"`,
      `declared reason: ${p.reason}. The escape hatch is visible here on purpose.`,
    )
  }

  const rank: Record<Severity, number> = { breaking: 0, risky: 1, safe: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

export function formatDiff(items: DiffItem[]): string {
  if (!items.length) return 'no breaking changes'
  return items
    .map(
      (i) =>
        `${i.severity.toUpperCase().padEnd(8)} ${i.code.padEnd(22)} ${i.message}` +
        (i.hint ? `\n${' '.repeat(32)}-> ${i.hint}` : ''),
    )
    .join('\n')
}
