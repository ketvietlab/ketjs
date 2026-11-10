#!/usr/bin/env node
// Compare the Node.js versions this repository names with the Node.js security releases.
//
// `.nvmrc` is the version contributors and benchmarks run. It must be a supported release line
// and must not be older than that line's latest security release, so a security release
// published after the last bump fails this check until `.nvmrc` moves.
//
// `engines.node` is the published install contract. Its floor follows security releases: it
// must not admit a release that lacks a security release of a supported line, nor a line whose
// support ended. The workflow passes `--strict-engines`, which makes those findings errors;
// without it they are warnings. Raising the floor changes what consumers may install, so it
// ships in a release: change NODE_ENGINES, every manifest and the documented requirement together.
//
// Usage:
//   node tools/node-security.mjs [--strict-engines] [--index FILE] [--schedule FILE] [--today YYYY-MM-DD]
//
// Without --index and --schedule the data is fetched from nodejs.org and the nodejs/Release
// repository. Exit status is 1 when an error is found, 2 when the data cannot be read.

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The `engines.node` every published package declares; `tools/release.mjs` refuses any other. */
export const NODE_ENGINES = '^24.22.1 || >=26.12.1'

export const INDEX_URL = 'https://nodejs.org/dist/index.json'
export const SCHEDULE_URL = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json'

/** @typedef {[number, number, number]} Version */
/** @typedef {{ version: string, date: string, security: boolean, lts: string | false }} Release */
/** @typedef {Record<string, { start: string, end: string, lts?: string, maintenance?: string }>} Schedule */
/** @typedef {{ errors: string[], warnings: string[], notes: string[] }} Report */

/** @param {string} text @returns {Version | null} */
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** @param {Version} a @param {Version} b */
export function compare(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/** @param {Version} v */
const show = (v) => v.join('.')

/**
 * The comparator subset that `engines.node` uses in practice: `>=`, `>`, `<=`, `<`, `=`, `^`,
 * `~` and bare versions, joined by spaces (and) and `||` (or). Anything else is refused rather
 * than guessed, because a misread range would report the wrong floor.
 *
 * @param {string} range
 * @returns {(v: Version) => boolean}
 */
export function parseRange(range) {
  const alternatives = range.split('||').map((part) => {
    const tests = part
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((comparator) => {
        const match = /^(>=|<=|>|<|=|\^|~)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(comparator)
        if (!match) throw new Error(`unsupported engines comparator "${comparator}" in "${range}"`)
        const op = match[1] ?? '='
        /** @type {Version} */
        const base = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)]
        const partial = match[3] === undefined ? 'major' : match[4] === undefined ? 'minor' : null
        /** @type {(v: Version) => boolean} */
        const below = (v) => compare(v, base) < 0
        if (op === '>=') return (/** @type {Version} */ v) => !below(v)
        if (op === '>') return (/** @type {Version} */ v) => compare(v, base) > 0
        if (op === '<') return below
        if (op === '<=') return (/** @type {Version} */ v) => compare(v, base) <= 0
        if (op === '^') return (/** @type {Version} */ v) => !below(v) && v[0] === base[0]
        if (op === '~' || partial === 'minor')
          return (/** @type {Version} */ v) =>
            !below(v) && v[0] === base[0] && (partial === 'major' || v[1] === base[1])
        if (partial === 'major') return (/** @type {Version} */ v) => v[0] === base[0]
        return (/** @type {Version} */ v) => compare(v, base) === 0
      })
    if (tests.length === 0) throw new Error(`empty engines alternative in "${range}"`)
    return (/** @type {Version} */ v) => tests.every((t) => t(v))
  })
  return (v) => alternatives.some((matches) => matches(v))
}

/**
 * @param {Release[]} index
 * @returns {Map<number, { latest: Version, security: { version: Version, date: string }[], all: Version[] }>}
 */
function lines(index) {
  /** @type {Map<number, { latest: Version, security: { version: Version, date: string }[], all: Version[] }>} */
  const byMajor = new Map()
  for (const release of index) {
    const version = parseVersion(release.version)
    if (!version) continue // pre-releases such as v27.0.0-alpha
    const line = byMajor.get(version[0]) ?? { latest: version, security: [], all: [] }
    if (compare(version, line.latest) > 0) line.latest = version
    if (release.security) line.security.push({ version, date: release.date })
    line.all.push(version)
    byMajor.set(version[0], line)
  }
  for (const line of byMajor.values()) {
    line.security.sort((a, b) => compare(b.version, a.version))
    line.all.sort(compare)
  }
  return byMajor
}

/** @param {Schedule} schedule @param {number} major @param {string} today */
function supported(schedule, major, today) {
  const entry = schedule[`v${major}`]
  return entry ? entry.start <= today && today < entry.end : false
}

/**
 * @param {{
 *   index: Release[],
 *   schedule: Schedule,
 *   nvmrc: string,
 *   engines: Record<string, string>,
 *   today: string,
 *   strictEngines?: boolean,
 * }} input
 * @returns {Report}
 */
export function assess({ index, schedule, nvmrc, engines, today, strictEngines = false }) {
  /** @type {Report} */
  const report = { errors: [], warnings: [], notes: [] }
  const byMajor = lines(index)

  const pinned = parseVersion(nvmrc)
  if (!pinned) {
    report.errors.push(`.nvmrc must name one exact version such as 26.13.0, not "${nvmrc.trim()}"`)
  } else {
    const line = byMajor.get(pinned[0])
    if (!supported(schedule, pinned[0], today)) {
      report.errors.push(
        `.nvmrc ${show(pinned)} is on Node.js ${pinned[0]}, which is not a supported release line on ${today}`,
      )
    }
    const missed = (line?.security ?? []).filter((s) => compare(s.version, pinned) > 0)
    if (missed.length > 0 && line) {
      const list = missed.map((s) => `${show(s.version)} (${s.date})`).join(', ')
      report.errors.push(
        `.nvmrc ${show(pinned)} lacks security release(s) ${list}; move it to ${show(line.latest)}, the latest ${pinned[0]}.x`,
      )
    } else if (line && compare(line.latest, pinned) > 0) {
      report.notes.push(`.nvmrc ${show(pinned)} has every security release; ${show(line.latest)} is newer.`)
    } else {
      report.notes.push(`.nvmrc ${show(pinned)} is the latest ${pinned[0]}.x.`)
    }
  }

  const ranges = new Map()
  for (const [manifest, range] of Object.entries(engines)) {
    const owners = ranges.get(range) ?? []
    owners.push(manifest)
    ranges.set(range, owners)
  }
  const flag = strictEngines ? report.errors : report.warnings
  for (const [range, owners] of ranges) {
    /** @type {(v: Version) => boolean} */
    let matches
    try {
      matches = parseRange(range)
    } catch (error) {
      report.errors.push(`${owners.join(', ')}: ${/** @type {Error} */ (error).message}`)
      continue
    }
    const who = owners.length === 1 ? owners[0] : `${owners.length} manifests`
    for (const [major, line] of [...byMajor].sort((a, b) => a[0] - b[0])) {
      const admitted = line.all.filter(matches)
      if (admitted.length === 0) continue
      const floor = admitted[0]
      if (!supported(schedule, major, today)) {
        if (schedule[`v${major}`] && schedule[`v${major}`].end <= today)
          flag.push(
            `engines "${range}" (${who}) admits Node.js ${major}, whose support ended on ${schedule[`v${major}`].end}`,
          )
        continue
      }
      const missed = line.security.filter((s) => compare(s.version, floor) > 0)
      if (missed.length > 0)
        flag.push(
          `engines "${range}" (${who}) admits ${show(floor)}, which lacks ${missed.length} security release(s) of ${major}.x; the latest is ${show(missed[0].version)} (${missed[0].date})`,
        )
    }
  }
  return report
}

/** @param {string} url */
async function fetchJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      if (attempt === 3) throw new Error(`${url}: ${/** @type {Error} */ (error).message}`)
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000))
    }
  }
}

/**
 * The root manifest and every `packages/*` manifest, including the private docs site, which is
 * not a workspace but builds on the same Node.js.
 *
 * @param {string} root
 */
export function readEngines(root) {
  const packages = readdirSync(new URL('packages/', root), { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(new URL(`packages/${entry.name}/package.json`, root)),
    )
    .map((entry) => `packages/${entry.name}/package.json`)
    .sort()
  const manifests = ['package.json', ...packages]
  /** @type {Record<string, string>} */
  const engines = {}
  for (const manifest of manifests) {
    const parsed = /** @type {{ engines?: { node?: string } }} */ (
      JSON.parse(readFileSync(new URL(manifest, root), 'utf8'))
    )
    if (parsed.engines?.node) engines[manifest] = parsed.engines.node
  }
  return engines
}

/** @param {string[]} argv */
async function main(argv) {
  /** @param {string} name */
  const option = (name) => {
    const at = argv.indexOf(name)
    return at === -1 ? undefined : argv[at + 1]
  }
  const root = new URL('../', import.meta.url).href
  const indexFile = option('--index')
  const scheduleFile = option('--schedule')
  /** @type {[Release[], Schedule]} */
  let data
  try {
    data = await Promise.all([
      indexFile ? JSON.parse(readFileSync(indexFile, 'utf8')) : fetchJson(INDEX_URL),
      scheduleFile ? JSON.parse(readFileSync(scheduleFile, 'utf8')) : fetchJson(SCHEDULE_URL),
    ])
  } catch (error) {
    console.error(`node-security: cannot read release data: ${/** @type {Error} */ (error).message}`)
    return 2
  }
  const report = assess({
    index: data[0],
    schedule: data[1],
    nvmrc: readFileSync(new URL('.nvmrc', root), 'utf8'),
    engines: readEngines(root),
    today: option('--today') ?? new Date().toISOString().slice(0, 10),
    strictEngines: argv.includes('--strict-engines'),
  })

  const actions = process.env.GITHUB_ACTIONS === 'true'
  for (const message of report.errors)
    console.log(actions ? `::error title=Node.js security::${message}` : `error: ${message}`)
  for (const message of report.warnings)
    console.log(actions ? `::warning title=Node.js security::${message}` : `warning: ${message}`)
  for (const message of report.notes) console.log(message)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = [
      ...report.errors.map((m) => `| error | ${m} |`),
      ...report.warnings.map((m) => `| warning | ${m} |`),
      ...report.notes.map((m) => `| ok | ${m} |`),
    ]
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Node.js security releases\n\n| Result | Finding |\n| --- | --- |\n${rows.join('\n')}\n\nSource: ${INDEX_URL} and ${SCHEDULE_URL}\n`,
    )
  }
  return report.errors.length > 0 ? 1 : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2))
