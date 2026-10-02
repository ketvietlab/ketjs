import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  CheckboxGroup,
  CountBadge,
  Field,
  Grid,
  Icon,
  IconButton,
  Inline,
  Link,
  LinkButton,
  LoadingState,
  MoneyField,
  Notice,
  NumberField,
  Progress,
  RadioGroup,
  SearchField,
  Select,
  Skeleton,
  Spinner,
  Stack,
  Switch,
  Tag,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from '@ketvietlab/design-system'

const render = (view: Parameters<typeof renderToString>[0]) =>
  renderToString(view).replace(/<!--.*?-->/gs, '')

test('typography separates visual role, semantic heading and numeric content', () => {
  const html = render(
    <Text as="h2" variant="headingLg" fontWeight="medium" numeric alignment="end">
      123.00
    </Text>,
  )
  assert.match(html, /^<h2 /)
  assert.match(html, /data-variant="headingLg"/)
  assert.match(html, /data-weight="medium"/)
  assert.match(html, /data-numeric="true"/)
  assert.match(html, /data-align="end"/)
  assert.match(
    render(
      <Text truncate breakWord>
        Long text
      </Text>,
    ),
    /data-truncate="true" data-break-word="true"/,
  )
  assert.match(
    render(<Text tone="muted">Legacy</Text>),
    /<span data-ui="text" data-tone="muted">Legacy<\/span>/,
  )
})

test('Lucide icons have one geometry and explicit decorative or informative semantics', () => {
  const decorative = render(<Icon name="plus" />)
  assert.match(decorative, /viewBox="0 0 24 24"/)
  assert.match(decorative, /stroke-width="2"/)
  assert.match(decorative, /aria-hidden="true"/)
  const informative = render(<Icon name="triangle-alert" label="Needs review" tone="warning" />)
  assert.match(informative, /role="img" aria-label="Needs review"/)
  assert.doesNotMatch(informative, /aria-hidden/)
})

test('action emphasis and tone are independent while legacy aliases still work', () => {
  const html = render(
    <Button label="Delete" variant="primary" tone="danger" pressed fullWidth icon="x" loading />,
  )
  assert.match(html, /data-tone="danger"/)
  assert.match(html, /data-variant="primary"/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /data-full-width="true"/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /data-ui="action-leading"/)
  assert.match(html, /data-ui="spinner"[^>]*aria-hidden="true"/)
  assert.doesNotMatch(html, /role="status"/)
  assert.match(render(<Button label="Remove" variant="destructive" size="prominent" />), /data-tone="danger"/)
  assert.match(render(<IconButton label="Add" icon={<Icon name="plus" />} />), /aria-label="Add"/)
  assert.match(render(<LinkButton label="Open" href="/record" />), /^<a /)
  assert.match(render(<LinkButton label="Open" href="/record" disabled />), /^<button /)
  assert.match(
    render(<Link label="Docs" href="https://example.com" target="_blank" />),
    /rel="noopener noreferrer"/,
  )
})

test('scalar fields share label, help and error associations including compound controls', () => {
  const cases = [
    <TextField id="field" name="x" label="Name" help="Hint" error="Invalid" prefix="SO" />,
    <SearchField id="field" name="x" label="Name" help="Hint" error="Invalid" clearable />,
    <NumberField id="field" name="x" label="Name" help="Hint" error="Invalid" />,
    <TextArea id="field" name="x" label="Name" help="Hint" error="Invalid" rows={4} />,
    <Select id="field" name="x" label="Name" help="Hint" error="Invalid" options={[]} />,
    <Switch id="field" name="x" label="Name" help="Hint" error="Invalid" />,
    <Field id="field" name="x" label="Name" help="Hint" error="Invalid" type="date" />,
  ]
  for (const view of cases) {
    const html = render(view)
    assert.equal([...html.matchAll(/for="field"/g)].length, 1)
    assert.equal([...html.matchAll(/id="field-help"/g)].length, 1)
    assert.equal([...html.matchAll(/id="field-error"/g)].length, 1)
    assert.match(html, /aria-describedby="field-help field-error"/)
    assert.match(html, /aria-invalid="true"/)
    assert.doesNotMatch(html, /<label[^>]*>(?:(?!<\/label>)[\s\S])*<label/)
  }
})

test('specialized inputs preserve native semantics and precision without value coercion', () => {
  assert.match(render(<SearchField id="q" name="q" label="Search" clearable />), /type="search"/)
  assert.match(
    render(<SearchField id="q" name="q" label="Search" clearable readOnly />),
    /data-ui="field-clear"[^>]*disabled/,
  )
  const money = render(
    <MoneyField
      id="money"
      name="money"
      label="Amount"
      currency="VND"
      precision={0}
      value="9007199254740993"
    />,
  )
  assert.match(money, /value="9007199254740993"/)
  assert.match(money, /step="1"/)
  assert.match(money, /inputmode="decimal"/)
  assert.match(money, /data-align="end"/)
  assert.match(money, /data-ui="field-affix">VND/)
  assert.match(
    render(<TextArea id="notes" name="notes" label="Notes" rows={4} resize="none" />),
    /rows="4" data-resize="none"/,
  )
  const select = render(
    <Select
      id="region"
      name="region"
      label="Region"
      placeholder="Choose region"
      required
      options={[{ value: 'vn', label: 'Vietnam' }]}
    />,
  )
  assert.match(select, /<option value="" disabled(?:="true")? selected(?:="true")?>Choose region/)
})

test('choice state is independent from native submitted value, with legacy value compatibility', () => {
  const chosen = render(<Checkbox id="a" name="warehouse" label="A" checked value="warehouse-a" />)
  assert.match(chosen, /value="warehouse-a" checked/)
  const unchecked = render(<Checkbox id="b" name="warehouse" label="B" checked={false} value="1" />)
  assert.doesNotMatch(unchecked, /\schecked(?:\s|>)/)
  assert.match(render(<Checkbox id="old" name="old" label="Old" value />), /value="1" checked/)
  assert.match(
    render(<Checkbox id="mixed" name="all" label="All" checked="indeterminate" />),
    /data-indeterminate="true" aria-checked="mixed"/,
  )
  assert.match(
    render(<Switch id="s" name="notify" label="Notify" checked value="enabled" />),
    /value="enabled" checked/,
  )
  for (const [Component, role] of [
    [CheckboxGroup, 'group'],
    [RadioGroup, 'radiogroup'],
  ] as const) {
    const group = render(
      <Component
        id="choices"
        name="choice"
        label="Choices"
        help="Pick"
        options={[{ value: 'a', label: 'A' }]}
      />,
    )
    assert.ok(group.includes(`role="${role}" aria-labelledby="choices-label"`))
    assert.match(group, /id="choices-label"/)
    assert.match(group, /aria-describedby="choices-help"/)
  }
})

test('status and tags separate information, live announcements and native commands', () => {
  assert.doesNotMatch(render(<CountBadge count={4} label="4 records" />), /role="status"/)
  assert.match(render(<CountBadge count={5} label="5 records" announce />), /role="status"/)
  assert.match(render(<Badge label="Paid" icon="check" tone="positive" />), /data-ui="icon"/)
  assert.match(
    render(<Badge label="Order" progress="partiallyComplete" progressLabel="Partially fulfilled" />),
    /Partially fulfilled/,
  )
  assert.match(render(<Tag label="A" removeHref="/?remove=a" />), /<a data-ui="tag-remove" href=/)
  const command = render(<Tag label="A" removeCommand={{ name: 'remove', value: 'a', form: 'order' }} />)
  assert.match(command, /<button data-ui="tag-remove" type="submit" name="remove" value="a" form="order"/)
  assert.match(command, /data-ui="icon"/)
  assert.doesNotMatch(render(<Tag label="A" href="/a" removeHref="/remove" disabled />), /href=/)
})

test('identity and feedback reuse primitives with explicit announcement policy', () => {
  const avatar = render(<Avatar name="Nguyễn Minh Châu" src="/avatar.jpg" decorative={false} />)
  assert.match(avatar, /role="img" aria-label="Nguyễn Minh Châu"/)
  assert.match(avatar, /data-ui="avatar-initials">MC/)
  assert.match(avatar, /data-ui="avatar-image" src="\/avatar.jpg" alt=""/)
  const notice = render(<Notice title="Saved" message="Changes saved" tone="positive" announcement="off" />)
  assert.doesNotMatch(notice, /role="(?:status|alert)"/)
  assert.match(notice, /data-ui="icon"/)
  assert.match(notice, /data-ui="text"/)
  const loading = render(<LoadingState label="Loading" />)
  assert.equal([...loading.matchAll(/role="status"/g)].length, 1)
  assert.match(loading, /data-ui="skeleton" aria-hidden="true"/)
  assert.match(render(<Spinner label="Wait" />), /role="status"/)
  assert.equal(
    [...render(<Skeleton label="Loading" lines={Infinity} />).matchAll(/data-ui="skeleton-line"/g)].length,
    3,
  )
  assert.match(render(<Progress label="Upload" value={120} size="large" />), /aria-valuenow="100"/)
})

test('layout exposes token roles and tooltip associates the actual focus target during SSR', () => {
  assert.match(
    render(<Inline items={[]} gap="column" align="between" blockAlign="baseline" wrap={false} />),
    /data-gap="column" data-align="between" data-block-align="baseline" data-wrap="false"/,
  )
  assert.match(
    render(<Stack items={[]} gap={{ desktop: 'compact', mobile: 'default' }} />),
    /data-gap="compact" data-mobile-gap="default"/,
  )
  assert.match(render(<Grid items={[]} columns={2} mobileColumns={1} />), /data-mobile-columns="1"/)
  const tooltip = render(
    <Tooltip
      id="hint"
      text="More information"
      trigger={({ describedBy }) => <Button label="Info" describedBy={describedBy} />}
    />,
  )
  assert.match(tooltip, /<button[^>]*aria-describedby="hint"/)
  assert.doesNotMatch(tooltip, /<span data-ui="tooltip-trigger" aria-describedby/)
})
