// The version ranges a module's `compatible` may state, read the way npm reads
// them, so `^1.5.0` means "1.5.0 or later, before 2.0.0" here as it does in a
// package.json next to it. Only the forms a module contract needs: an exact or
// partial version, a caret and a tilde.

type Version = { major: number; minor: number; patch: number; pre: string[] }

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/
const RANGE = /^([\^~]?)v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export const parseVersion = (text: string): Version | null => {
  const match = VERSION.exec(text.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  }
}

const compareIdentifiers = (left: string, right: string): number => {
  const a = /^\d+$/.test(left) ? Number(left) : null
  const b = /^\d+$/.test(right) ? Number(right) : null
  if (a !== null && b !== null) return a - b
  if (a !== null) return -1
  if (b !== null) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Negative, zero or positive as `left` is before, equal to or after `right`. */
export const compareVersions = (left: Version, right: Version): number => {
  const core = left.major - right.major || left.minor - right.minor || left.patch - right.patch
  if (core) return core
  // A prerelease comes before its release.
  if (!left.pre.length || !right.pre.length) return right.pre.length - left.pre.length
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    if (left.pre[i] === undefined) return -1
    if (right.pre[i] === undefined) return 1
    const order = compareIdentifiers(left.pre[i] as string, right.pre[i] as string)
    if (order) return order
  }
  return 0
}

/**
 * Whether `version` satisfies `range`: `1.2.3` exactly, `1.2` meaning 1.2.x, `^1.2.3`
 * up to the next major (the next minor below 1.0, the next patch below 0.1), and
 * `~1.2.3` up to the next minor. Null when either side cannot be read.
 */
export const satisfies = (version: string, range: string): boolean | null => {
  const actual = parseVersion(version)
  const match = RANGE.exec(range.trim())
  if (!actual || !match) return null
  const [, operator, majorText, minorText, patchText, preText] = match
  const major = Number(majorText)
  const minor = minorText === undefined ? null : Number(minorText)
  const patch = patchText === undefined ? null : Number(patchText)
  if (preText !== undefined && patch === null) return null
  const low: Version = { major, minor: minor ?? 0, patch: patch ?? 0, pre: preText ? preText.split('.') : [] }
  let high: Version
  if (operator === '^') {
    if (major > 0 || minor === null) high = { major: major + 1, minor: 0, patch: 0, pre: ['0'] }
    else if (minor > 0 || patch === null) high = { major, minor: minor + 1, patch: 0, pre: ['0'] }
    else high = { major, minor, patch: patch + 1, pre: ['0'] }
  } else if (operator === '~' || patch === null) {
    high =
      minor === null
        ? { major: major + 1, minor: 0, patch: 0, pre: ['0'] }
        : { major, minor: minor + 1, patch: 0, pre: ['0'] }
  } else {
    return compareVersions(actual, low) === 0
  }
  // A prerelease of a later version is not what anyone asking for a range meant.
  if (
    actual.pre.length &&
    !(
      low.pre.length &&
      actual.major === low.major &&
      actual.minor === low.minor &&
      actual.patch === low.patch
    )
  )
    return false
  return compareVersions(actual, low) >= 0 && compareVersions(actual, high) < 0
}
