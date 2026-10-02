/**
 * Phone numbers, one spelling per subscriber.
 *
 * The same customer arrives as `0708 580 468` from a counter, `+84708580468`
 * from a website form and `84708580468` from a marketplace. Stored as typed,
 * those are three people to every lookup that compares text. E.164 (`+84…`)
 * is the one spelling all of them share, so it is what gets stored and what a
 * search is normalised to before it compares anything.
 *
 * Only regions whose national format is known here are rewritten; anything
 * else keeps its digits, because guessing a country code corrupts a number
 * that was merely unfamiliar.
 */

type Region = {
  callingCode: string
  /** National significant number lengths, trunk prefix stripped. */
  lengths: number[]
  trunkPrefix: string
  /** What a national number looks like once its trunk prefix is gone. */
  national: RegExp
}

const REGIONS: Record<string, Region> = {
  // Mobiles are 9 digits after the trunk 0; landlines (02x…) are 10.
  VN: { callingCode: '84', lengths: [9, 10], trunkPrefix: '0', national: /^(?:[35789]\d{8}|2\d{9})$/ },
}

export const DEFAULT_PHONE_REGION = 'VN'

const clean = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()

/**
 * The E.164 form of a phone number, or null when it cannot be read as one.
 * `region` is the country a number without a country code is dialled in.
 */
export const normalizePhone = (value: unknown, region: string = DEFAULT_PHONE_REGION): string | null => {
  const raw = clean(value)
  if (!raw) return null
  const international = raw.startsWith('+') || raw.startsWith('00')
  let digits = raw.replace(/\D/g, '')
  if (international && raw.startsWith('00')) digits = digits.slice(2)
  if (!digits) return null
  const home = REGIONS[region.toUpperCase()]
  if (international) {
    // A trunk 0 written after the country code (+84 0708…) is a common slip.
    if (home && digits.startsWith(`${home.callingCode}${home.trunkPrefix}`)) {
      const national = digits.slice(home.callingCode.length + home.trunkPrefix.length)
      if (home.lengths.includes(national.length)) return `+${home.callingCode}${national}`
    }
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }
  if (!home) return null
  if (digits.startsWith(home.trunkPrefix)) {
    const national = digits.slice(home.trunkPrefix.length)
    return home.lengths.includes(national.length) ? `+${home.callingCode}${national}` : null
  }
  // Written with the country code but without the plus: 84708580468.
  if (digits.startsWith(home.callingCode)) {
    const national = digits.slice(home.callingCode.length)
    if (home.lengths.includes(national.length)) return `+${home.callingCode}${national}`
  }
  // The trunk 0 dropped (708580468), accepted only where the digits look like
  // a national number: nine arbitrary digits are not a guess worth storing.
  if (home.national.test(digits)) return `+${home.callingCode}${digits}`
  return null
}

/**
 * What to store and compare: the E.164 form when there is one, the bare
 * digits (with a leading plus kept) when there is not, so an unreadable number
 * is still kept rather than dropped.
 */
export const phoneKey = (value: unknown, region: string = DEFAULT_PHONE_REGION): string | null => {
  const e164 = normalizePhone(value, region)
  if (e164) return e164
  const raw = clean(value)
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  return raw.startsWith('+') || raw.startsWith('00') ? `+${digits.replace(/^00/, '')}` : digits
}

/**
 * The fragment to look for when someone types part of a number into a search
 * box. `0708` means the stored `+84708…`; digits without a trunk prefix are
 * matched as typed.
 */
export const phoneSearchFragment = (value: unknown, region: string = DEFAULT_PHONE_REGION): string | null => {
  const full = normalizePhone(value, region)
  if (full) return full
  const raw = clean(value)
  if (!/^[+\d\s().-]+$/.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  const home = REGIONS[region.toUpperCase()]
  if (raw.startsWith('+')) return `+${digits}`
  if (home && digits.startsWith(home.trunkPrefix) && digits.length > home.trunkPrefix.length)
    return `+${home.callingCode}${digits.slice(home.trunkPrefix.length)}`
  return digits
}
