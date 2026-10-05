import { each } from '@ketvietlab/ketjs-view'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import {
  ActionGroup,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  Code,
  CountBadge,
  EmptyState,
  Field,
  IconButton,
  Icon,
  Link,
  Checkbox,
  CheckboxGroup,
  RadioGroup,
  Switch,
  TextField,
  TextArea,
  SearchField,
  NumberField,
  MoneyField,
  Tooltip,
  Spinner,
  Skeleton,
  Grid,
  Inline,
  LinkButton,
  LoadingState,
  MediaLabel,
  NavList,
  Notice,
  Progress,
  Select,
  Stack,
  TabbedView,
  Tabs,
  Tag,
  Text,
} from '../index.ts'

export const primitiveSections = [
  { id: 'foundations', label: 'Typography & icons', components: ['Icon'] },
  {
    id: 'actions',
    label: 'Actions',
    components: ['ActionGroup', 'Button', 'IconButton', 'LinkButton', 'Link'],
  },
  {
    id: 'status',
    label: 'Status & identity',
    components: ['Avatar', 'Badge', 'Code', 'CountBadge', 'MediaLabel', 'Tag', 'Text'],
  },
  { id: 'fields', label: 'Fields', components: ['Field'] },
  {
    id: 'navigation',
    label: 'Navigation',
    components: ['Breadcrumbs', 'NavItem', 'NavList', 'Tab', 'TabPanel', 'TabbedView', 'Tabs'],
  },
  { id: 'feedback', label: 'Feedback', components: ['EmptyState', 'LoadingState', 'Notice'] },
  { id: 'progress', label: 'Progress', components: ['Progress'] },
] as const

const Row = (props: { label: string; detail: string; children: JSXChild }): TemplateResult => (
  <div data-ui="primitive-row">
    <div data-ui="primitive-caption">
      <h3>{props.label}</h3>
      <p>{props.detail}</p>
    </div>
    <div data-ui="primitive-sample">{props.children}</div>
  </div>
)

const Plus = (): TemplateResult => <Icon name="plus" />

export type PrimitiveHarnessProps = {
  theme?: 'light' | 'dark' | 'system'
  density?: 'compact' | 'default' | 'comfortable'
  tab?: 'overview' | 'activity'
}

/** A render-pure comparison surface. Every sample uses the public component contract. */
export const PrimitiveHarness = (props: PrimitiveHarnessProps = {}): TemplateResult => {
  const href = (tab: 'overview' | 'activity') =>
    `/primitives?theme=${props.theme ?? 'system'}&density=${props.density ?? 'default'}&tab=${tab}#primitive-navigation`
  const tab = props.tab ?? 'overview'
  const specimens: Record<(typeof primitiveSections)[number]['id'], JSXChild> = {
    foundations: (
      <>
        <Row label="Type roles" detail="Body and heading styles are independent of HTML heading level.">
          <Stack
            gap="compact"
            items={[
              <Text as="h2" variant="headingLg">
                Inventory overview
              </Text>,
              <Text as="h3" variant="headingMd">
                Stock availability
              </Text>,
              <Text as="p" variant="bodyMd">
                Body · 13 / 20 px
              </Text>,
              <Text as="p" variant="bodySm" tone="muted">
                Supporting text · 12 / 16 px
              </Text>,
              <Text numeric variant="bodyMd">
                1,234,567.89
              </Text>,
              <Text truncate>
                Long operational descriptions stay within their allocated column without changing the
                surrounding layout.
              </Text>,
            ]}
          />
        </Row>
        <Row label="Lucide" detail="One icon contract: geometry, tone and accessible naming.">
          <Inline
            gap="column"
            items={[
              <Icon name="plus" label="Add" />,
              <Icon name="search" label="Search" />,
              <Icon name="circle-check" tone="positive" label="Complete" />,
              <Icon name="triangle-alert" tone="warning" label="Warning" />,
              <Icon name="x" label="Close" />,
            ]}
          />
        </Row>
        <Row
          label="Layout rhythm"
          detail="8px actions, 12px columns, 16px groups; responsive gaps are explicit."
        >
          <Grid
            columns={2}
            mobileColumns={1}
            gap={{ desktop: 'column', mobile: 'default' }}
            items={[
              <Stack
                gap="compact"
                items={[
                  <Text variant="headingSm">Related information</Text>,
                  <Text tone="muted">8px within a group</Text>,
                ]}
              />,
              <Inline
                align="between"
                blockAlign="baseline"
                gap="column"
                items={[<Text variant="headingSm">Available</Text>, <Text numeric>1,284</Text>]}
              />,
            ]}
          />
        </Row>
      </>
    ),
    actions: (
      <>
        <Row label="Hierarchy" detail="One height; emphasis and semantic tone are independent.">
          <ActionGroup
            label="Action hierarchy"
            actions={[
              <Button label="Create project" variant="primary" leading={<Plus />} />,
              <Button label="Save draft" />,
              <Button label="View details" variant="tertiary" />,
              <Button label="Archive" variant="destructive" />,
            ]}
          />
        </Row>
        <Row label="Tone × emphasis" detail="Critical commands can be primary, secondary or tertiary.">
          <ActionGroup
            actions={[
              <Button label="Delete record" variant="primary" tone="danger" />,
              <Button label="Remove selection" tone="danger" />,
              <Button label="Discard" variant="tertiary" tone="danger" />,
              <Button label="Approve record" variant="primary" tone="positive" />,
              <Button label="Approved" tone="positive" />,
              <Button label="Pinned" pressed />,
              <Link label="View all records" href="#primitive-fields" />,
            ]}
          />
        </Row>
        <Row label="Stable loading" detail="The same label and icon retain width while progress is shown.">
          <ActionGroup
            actions={[
              <Button id="primitive-action-rest" label="Save record" icon="check" variant="primary" />,
              <Button
                id="primitive-action-loading"
                label="Save record"
                icon="check"
                variant="primary"
                loading
              />,
              <Tooltip
                id="primitive-action-tip"
                text="Create a new project"
                trigger={({ describedBy }) => (
                  <IconButton label="Create project" icon={<Icon name="plus" />} describedBy={describedBy} />
                )}
              />,
            ]}
          />
        </Row>
        <Row label="States" detail="Resting, unavailable and in progress.">
          <ActionGroup
            label="Action states"
            actions={[
              <Button label="Save changes" variant="primary" />,
              <Button label="Save changes" variant="primary" disabled />,
              <Button label="Saving changes" variant="primary" loading />,
              <LinkButton label="Opening project" href="#primitive-actions" loading />,
            ]}
          />
        </Row>
        <Row label="Sizes & icons" detail="Matched text and icon targets at each size.">
          <Inline
            items={(['compact', 'default', 'prominent', 'large'] as const).map((size) => (
              <ActionGroup
                label={`${size} actions`}
                actions={[
                  <Button label={size[0].toUpperCase() + size.slice(1)} size={size} />,
                  <IconButton
                    label={`Add project · ${size}`}
                    icon={<Plus />}
                    size={size}
                    variant="secondary"
                  />,
                ]}
              />
            ))}
          />
        </Row>
        <Row label="Long labels" detail="Narrow layouts retain the icon and contain the label.">
          <ActionGroup
            label="Long action labels"
            actions={[
              <Button label="Create a project for the regional operations team" leading={<Plus />} />,
              <LinkButton label="Browse components" href="/components" variant="tertiary" leading="↗" />,
            ]}
          />
        </Row>
      </>
    ),
    status: (
      <>
        <Row
          label="Status detail"
          detail="Progress and icon are alternative badge treatments. Counts announce only when requested."
        >
          <Inline
            items={[
              <Badge label="Paid" tone="positive" icon="check" />,
              <Badge label="Fulfilment" progress="partiallyComplete" progressLabel="Partially complete" />,
              <Badge label="Draft" size="small" />,
              <CountBadge count={24} label="24 records" />,
              <Avatar name="Nguyễn Minh Châu" src="data:image/png;base64,broken" decorative={false} />,
              <Tag label="Disabled selection" removeHref="#primitive-status" disabled />,
            ]}
          />
        </Row>
        <Row label="Tag command" detail="Removing a form selection submits a named native command.">
          <form id="primitive-tag-form" action="/primitives" method="get">
            <Tag label="Warehouse A" removeCommand={{ name: 'remove', value: 'warehouse-a' }} />
          </form>
        </Row>
        <Row label="Semantic tones" detail="Quiet surfaces with readable, explicit labels.">
          <Inline
            items={[
              <Badge label="Draft" />,
              <Badge label="In progress" tone="info" />,
              <Badge label="Approved" tone="positive" />,
              <Badge label="Needs review" tone="warning" />,
              <Badge label="Overdue" tone="danger" />,
            ]}
          />
        </Row>
        <Row label="Tags & counts" detail="Categories, removable filters and exact totals.">
          <Inline
            items={[
              <Tag label="Operations" />,
              <Tag
                label="Hà Nội"
                removeHref="#primitive-status"
                removeLabel="Remove Hà Nội filter specimen"
              />,
              <CountBadge count={0} label="No pending items" />,
              <CountBadge count={128} label="128 pending items" />,
              <Text tone="muted">Updated just now</Text>,
            ]}
          />
        </Row>
        <Row label="Identity" detail="Three sizes with Vietnamese name fallbacks.">
          <Inline
            items={[
              <Avatar name="Nguyễn Minh Châu" size="small" />,
              <Avatar name="Nguyễn Minh Châu" />,
              <Avatar name="Nguyễn Minh Châu" size="large" />,
              <MediaLabel label="Nguyễn Minh Châu · Operations" />,
              <Code value="PRJ-0042" context="project" />,
            ]}
          />
        </Row>
        <Row label="Content pressure" detail="Long names, unbroken identifiers and reserved media.">
          <Stack
            gap="compact"
            items={[
              <MediaLabel
                label="Regional operations · Thành phố Hồ Chí Minh · Planning and coordination"
                reserveImage
              />,
              <Tag
                label="regional-operations-planning-and-coordination-vietnam-2026"
                removeHref="#primitive-status"
              />,
              <Badge label="Awaiting approval from the regional operations coordinator" tone="warning" />,
              <Code value="workspace_vietnam_regional_operations_planning_2026_000042" />,
            ]}
          />
        </Row>
      </>
    ),
    fields: (
      <>
        <Row
          label="Shared field frame"
          detail="Every control uses the same label, help, error and geometry contract."
        >
          <Stack
            items={[
              <TextField
                id="primitive-large"
                name="large"
                label="Large input"
                size="large"
                value="36px desktop / 44px mobile"
              />,
              <TextField
                id="primitive-affix"
                name="reference"
                label="Reference"
                prefix="SO"
                suffix="/ 2026"
                value="1042"
                help="Prefix and suffix belong to the control."
              />,
              <SearchField
                id="primitive-search"
                name="q"
                label="Search"
                value="Regional stock"
                prefix={<Icon name="search" />}
                clearable
              />,
              <TextField
                id="primitive-affix-error"
                name="reference-error"
                label="Invalid reference"
                prefix="SO"
                value="?"
                error="Enter a valid reference."
              />,
              <TextField
                id="primitive-affix-disabled"
                name="reference-disabled"
                label="Unavailable"
                suffix="kg"
                disabled
                value="50"
              />,
              <NumberField
                id="primitive-number"
                name="quantity"
                label="Quantity"
                value="12"
                min="0"
                step="1"
              />,
              <MoneyField
                id="primitive-money"
                name="amount"
                label="Amount"
                value="1250000"
                currency="VND"
                precision={0}
              />,
              <TextArea
                id="primitive-textarea"
                name="notes"
                label="Notes"
                rows={3}
                resize="none"
                value="Delivery instructions"
              />,
            ]}
          />
        </Row>
        <Row
          label="Choices"
          detail="Selection state and form value are separate; mixed selection is enhanced by the shared runtime."
        >
          <Stack
            gap="compact"
            items={[
              <Checkbox
                id="primitive-mixed"
                name="selection"
                label="Partial selection"
                checked="indeterminate"
                value="all"
              />,
              <Checkbox
                id="primitive-checked-value"
                name="warehouse"
                label="Warehouse A"
                checked
                value="warehouse-a"
              />,
              <CheckboxGroup
                id="primitive-checkboxes"
                name="channels"
                label="Channels"
                options={[
                  { value: 'email', label: 'Email', checked: true },
                  { value: 'sms', label: 'SMS' },
                ]}
              />,
              <RadioGroup
                id="primitive-radio"
                name="delivery"
                label="Delivery"
                value="normal"
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'express', label: 'Express' },
                ]}
              />,
              <Switch
                id="primitive-switch"
                name="notifications"
                label="Notifications"
                checked
                value="enabled"
              />,
            ]}
          />
        </Row>
        <Row label="Text & selection" detail="Shared label column and aligned control edges.">
          <Stack
            gap="compact"
            items={[
              <Field
                id="primitive-name"
                name="project"
                label="Project name"
                value="Regional operations"
                required
              />,
              <Select
                id="primitive-region"
                name="region"
                label="Region"
                value="hn"
                options={[
                  { value: 'hn', label: 'Hà Nội' },
                  { value: 'hcm', label: 'Thành phố Hồ Chí Minh' },
                ]}
              />,
              <Field
                id="primitive-description"
                name="description"
                label="Description"
                type="textarea"
                placeholder="Add a short description…"
                help="Visible to everyone in this project."
              />,
            ]}
          />
        </Row>
        <Row label="Validation & access" detail="Help, error, read-only and disabled states.">
          <Stack
            gap="compact"
            items={[
              <Field
                id="primitive-email"
                name="email"
                label="Contact email"
                type="email"
                value="chau@"
                required
                help="Use your work email."
                error="Enter a complete email address."
              />,
              <Field
                id="primitive-reference"
                name="reference"
                label="Reference"
                value="PRJ-0042"
                readOnly
                help="Assigned automatically."
              />,
              <Field id="primitive-owner" name="owner" label="Owner" value="Nguyễn Minh Châu" disabled />,
            ]}
          />
        </Row>
        <Row label="Select states" detail="Consistent chevron inset, long values and native selection.">
          <Stack
            gap="compact"
            items={[
              <Select
                id="primitive-select-long"
                name="coordination"
                label="Coordination"
                value="regional"
                options={[
                  { value: 'regional', label: 'Regional planning and coordination · Thành phố Hồ Chí Minh' },
                  { value: 'local', label: 'Local operations' },
                ]}
              />,
              <Select
                id="primitive-select-invalid"
                name="priority"
                label="Priority"
                value=""
                required
                error="Choose a priority."
                options={[
                  { value: '', label: 'Choose a priority…', disabled: true },
                  { value: 'normal', label: 'Normal' },
                  { value: 'urgent', label: 'Urgent' },
                ]}
              />,
              <Select
                id="primitive-select-disabled"
                name="workspace"
                label="Workspace"
                value="vietnam"
                disabled
                options={[{ value: 'vietnam', label: 'Vietnam operations' }]}
              />,
            ]}
          />
        </Row>
        <Row label="Choices" detail="Native keyboard interaction and wrapping labels.">
          <Stack
            gap="compact"
            items={[
              <Field id="primitive-notify" name="notify" label="Send updates" type="checkbox" value={true} />,
              <Field
                id="primitive-access"
                name="access"
                label="Access"
                type="radio"
                value="team"
                options={[
                  { value: 'team', label: 'Team' },
                  { value: 'private', label: 'Private' },
                  { value: 'public', label: 'Public', disabled: true },
                ]}
              />,
              <Field
                id="primitive-channels"
                name="channels"
                label="Channels"
                type="checkbox-group"
                optionsOrientation="vertical"
                options={[
                  { value: 'email', label: 'Email notifications', checked: true },
                  { value: 'digest', label: 'Weekly summary for the regional operations team' },
                ]}
              />,
            ]}
          />
        </Row>
      </>
    ),
    navigation: (
      <>
        <Row label="Location" detail="Collapsed ancestors remain native links.">
          <Breadcrumbs
            label="Project location"
            maxItems={3}
            overflowLabel="Show parent locations"
            items={[
              { label: 'Workspace', href: '#primitive-navigation' },
              { label: 'Operations', href: '#primitive-navigation' },
              { label: 'Vietnam', href: '#primitive-navigation' },
              { label: 'Regional planning' },
            ]}
          />
        </Row>
        <Row label="Navigation list" detail="The active route and counts share a clear baseline.">
          <NavList
            label="Project sections"
            items={[
              { label: 'Overview', href: href('overview'), active: tab === 'overview', leading: '◇' },
              {
                label: 'Activity',
                href: href('activity'),
                active: tab === 'activity',
                leading: '≡',
                count: 12,
              },
            ]}
          />
        </Row>
        <Row label="Route tabs" detail="Real URL-backed tabs with an associated panel.">
          <TabbedView
            id="primitive-project"
            label="Project views"
            items={[
              { id: 'overview', label: 'Overview', href: href('overview'), active: tab === 'overview' },
              {
                id: 'activity',
                label: 'Activity',
                href: href('activity'),
                active: tab === 'activity',
                count: 12,
              },
            ]}
            body={
              <Text>
                {tab === 'overview'
                  ? 'A shared workspace for the regional operations team.'
                  : 'Nguyễn Minh Châu updated the project description.'}
              </Text>
            }
          />
        </Row>
      </>
    ),
    feedback: (
      <>
        <Row label="Notices" detail="Information, success, warning and recovery.">
          <Stack
            gap="compact"
            items={[
              <Notice title="Scheduled" message="Your report will be ready tomorrow." />,
              <Notice title="Saved" message="All changes are up to date." tone="positive" />,
              <Notice title="Review needed" message="Two projects are missing an owner." tone="warning" />,
              <Notice
                title="Unable to sync"
                message="Check the connection before trying again."
                tone="danger"
                actions={<LinkButton label="Review connection" href="#primitive-fields" size="compact" />}
              />,
            ]}
          />
        </Row>
        <Row label="Empty" detail="A useful next step with restrained emphasis.">
          <EmptyState
            title="No projects yet"
            message="Create a project to bring your team’s work together."
            actions={<LinkButton label="Explore actions" href="#primitive-actions" size="compact" />}
          />
        </Row>
        <Row
          label="Shared indicators"
          detail="The same spinner and skeleton serve actions and larger loading states."
        >
          <Inline
            items={[
              <Spinner label="Loading results" size="small" />,
              <Spinner label="Preparing report" />,
              <Skeleton label="Loading summary" lines={2} />,
            ]}
          />
        </Row>
        <Row label="Loading" detail="A named live region and decorative skeletons.">
          <LoadingState label="Loading project activity" lines={3} />
        </Row>
      </>
    ),
    progress: (
      <Row label="Completion" detail="Zero, partial, complete and text-free tracks.">
        <Stack
          gap="loose"
          items={[
            <Progress label="Not started" value={0} />,
            <Progress label="Project completion" value={64} />,
            <Progress label="Review in progress" value={38} tone="warning" size="large" />,
            <Progress label="Overdue tasks" value={16} tone="danger" />,
            <Progress label="All tasks complete" value={100} tone="positive" />,
            <Progress label="Background preparation" value={72} showValue={false} />,
          ]}
        />
      </Row>
    ),
  }
  return (
    <div data-ui="primitive-harness">
      <Tabs
        label="Primitive families"
        items={primitiveSections.map((section) => ({
          id: section.id,
          label: section.label,
          href: `#primitive-${section.id}`,
        }))}
      />
      {each(
        primitiveSections,
        (section) => section.id,
        (section, index) => (
          <section
            data-ui="primitive-section"
            id={`primitive-${section.id}`}
            aria-labelledby={`primitive-${section.id}-title`}
          >
            <header data-ui="primitive-section-head">
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <h2 id={`primitive-${section.id}-title`}>{section.label}</h2>
              <span>{section.components.join(' · ')}</span>
            </header>
            {specimens[section.id]}
          </section>
        ),
      )}
    </div>
  )
}
