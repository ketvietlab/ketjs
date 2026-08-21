import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ID_COUNTER_RANGE, ID_EPOCH_MS, createIdGenerator, decodeId } from 'ketjs'

/** A clock the test moves by hand: none of this is testable against a real one. */
const clock = (start: number) => {
  let ms = start
  return {
    now: () => ms,
    set: (v: number) => {
      ms = v
    },
    advance: (by: number) => {
      ms += by
    },
  }
}

const AT = ID_EPOCH_MS + 1_000

test('id: the number carries the millisecond it was made', () => {
  const c = clock(AT)
  const ids = createIdGenerator({ now: c.now, random: () => 0 })
  const id = ids.next()

  assert.equal(decodeId(id).at.getTime(), AT)
  assert.equal(decodeId(id).counter, 0)
  assert.equal(id, 1_000 * ID_COUNTER_RANGE, 'one second past the epoch, first slot')
})

test('id: sorting groups creation by millisecond and every local id is unique', () => {
  const c = clock(AT)
  // Start near the end so the counter wraps. Counter order inside one
  // millisecond is intentionally unspecified; the timestamp remains sortable.
  const ids = createIdGenerator({ now: c.now, random: () => 2040 / ID_COUNTER_RANGE })

  const made: number[] = []
  for (let i = 0; i < 50; i++) {
    made.push(ids.next())
    if (i % 7 === 0) c.advance(1)
  }
  const decodedTimes = [...made].sort((a, b) => a - b).map((id) => decodeId(id).at.getTime())
  assert.deepEqual(
    decodedTimes,
    [...decodedTimes].sort((a, b) => a - b),
  )
  assert.equal(new Set(made).size, made.length, 'and none repeats')
})

test('id: a random start keeps ids inside the millisecond it belongs to', () => {
  const c = clock(AT)
  // A start near the top of the range: the counter must wrap without the id
  // wandering into the next millisecond's numbers.
  const ids = createIdGenerator({ now: c.now, random: () => 2040 / ID_COUNTER_RANGE })

  const made = Array.from({ length: 10 }, () => ids.next())
  for (const id of made) assert.equal(decodeId(id).at.getTime(), AT, 'still this millisecond')
  assert.equal(new Set(made.map((id) => decodeId(id).counter)).size, 10, 'ten distinct slots')
})

test('id: two writers with different entropy start in different slots', () => {
  const c = clock(AT)
  // Two processes, same clock, different entropy — the case a node id would have
  // had to be configured for, and would have been configured wrongly.
  const a = createIdGenerator({ now: c.now, random: () => 0.1 })
  const b = createIdGenerator({ now: c.now, random: () => 0.7 })

  const from = (g: { next(): number }) => Array.from({ length: 20 }, () => g.next())
  const overlap = new Set(from(a)).intersection(new Set(from(b)))
  assert.equal(overlap.size, 0, 'different starts, so no shared slot')
})

test('id: a full millisecond waits rather than borrowing the next one', () => {
  const c = clock(AT)
  const ids = createIdGenerator({ now: c.now, random: () => 0 })

  const full = Array.from({ length: ID_COUNTER_RANGE }, () => ids.next())
  assert.equal(new Set(full).size, ID_COUNTER_RANGE, 'every slot used exactly once')
  for (const id of full) assert.equal(decodeId(id).at.getTime(), AT)

  c.advance(1)
  const next = ids.next()
  assert.equal(decodeId(next).at.getTime(), AT + 1, 'the 2049th belongs to the next millisecond')
  assert.ok(next > full[full.length - 1]!, 'and still sorts after')
})

test('id: with the clock standing still, the 2049th spins until it advances', () => {
  // The branch above never runs when a test advances the clock by hand, and an
  // untested spin loop is where an infinite loop hides. Here the clock only moves
  // because the generator keeps asking.
  let ms = AT
  let reads = 0
  const ids = createIdGenerator({
    now: () => {
      reads++
      if (reads > ID_COUNTER_RANGE + 3) ms = AT + 1
      return ms
    },
    random: () => 0,
  })

  const full = Array.from({ length: ID_COUNTER_RANGE }, () => ids.next())
  const spilled = ids.next()

  assert.equal(decodeId(spilled).at.getTime(), AT + 1, 'it waited for the next millisecond')
  assert.ok(spilled > full[full.length - 1]!, 'and did not borrow a number from it')
  assert.equal(new Set([...full, spilled]).size, ID_COUNTER_RANGE + 1)
})

test('id: the full-millisecond wait still refuses a large clock regression', () => {
  let reads = 0
  const ids = createIdGenerator({
    now: () => (++reads <= ID_COUNTER_RANGE + 1 ? AT : AT - 10_000),
    random: () => 0,
  })

  for (let i = 0; i < ID_COUNTER_RANGE; i++) ids.next()
  assert.throws(
    () => ids.next(),
    (e: unknown) => (e as { code: string }).code === 'E_CLOCK_REGRESSION',
  )
})

test('id: a small clock step backwards holds the line instead of repeating', () => {
  const c = clock(AT)
  const seen: number[] = []
  const regressions: number[] = []
  const ids = createIdGenerator({
    now: c.now,
    random: () => 0,
    onClockRegression: (by) => regressions.push(by),
  })

  seen.push(ids.next(), ids.next())
  c.set(AT - 100) // NTP nudges, or the VM moved host
  seen.push(ids.next(), ids.next())

  assert.deepEqual(
    seen,
    [...seen].sort((a, b) => a - b),
    'still increasing',
  )
  assert.equal(new Set(seen).size, seen.length, 'and still unique')
  assert.deepEqual(regressions, [100], 'reported once, not once per id')

  c.set(AT + 1)
  seen.push(ids.next())
  c.set(AT)
  seen.push(ids.next())
  assert.deepEqual(regressions, [100, 1], 'a later regression incident is reported again')
})

test('id: a large clock step backwards refuses rather than inventing order', () => {
  const c = clock(AT)
  const ids = createIdGenerator({ now: c.now, random: () => 0 })
  ids.next()

  c.set(AT - 10_000)
  assert.throws(
    () => ids.next(),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_CLOCK_REGRESSION')
      return true
    },
  )
})

test('id: a clock before the epoch is refused, not wrapped into a negative id', () => {
  const ids = createIdGenerator({ now: () => ID_EPOCH_MS - 1, random: () => 0 })
  assert.throws(
    () => ids.next(),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_CLOCK_BEFORE_EPOCH')
      return true
    },
  )
})

test('id: invalid clock and entropy sources fail with actionable errors', () => {
  assert.throws(
    () => createIdGenerator({ now: () => Number.NaN }).next(),
    (e: unknown) => (e as { code: string }).code === 'E_INVALID_ID_CLOCK',
  )
  assert.throws(
    () => createIdGenerator({ now: () => AT, random: () => 1 }).next(),
    (e: unknown) => (e as { code: string }).code === 'E_INVALID_ID_ENTROPY',
  )
})

test('id: decode refuses values that could already have lost precision', () => {
  for (const id of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
    assert.throws(
      () => decodeId(id),
      (e: unknown) => (e as { code: string }).code === 'E_INVALID_ID',
    )
  }
})

test('id: the far end of the range is still an exact JavaScript integer', () => {
  // 42 bits of milliseconds from the epoch — the last id the scheme can mint.
  const last = ID_EPOCH_MS + 2 ** 42 - 1
  const ids = createIdGenerator({ now: () => last, random: () => 0 })
  const id = ids.next()

  assert.ok(Number.isSafeInteger(id), 'below MAX_SAFE_INTEGER, so === still means equal')
  assert.equal(decodeId(id).at.getTime(), last, 'and it still decodes exactly')
  assert.ok(new Date(last).getUTCFullYear() > 2160, 'which is not this century')
})

test('id: past the range it fails loudly rather than losing precision', () => {
  const ids = createIdGenerator({ now: () => ID_EPOCH_MS + 2 ** 42, random: () => 0 })
  assert.throws(
    () => ids.next(),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_ID_EXHAUSTED')
      return true
    },
  )
})
