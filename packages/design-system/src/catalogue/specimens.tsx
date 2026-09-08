import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { ActionGroup, Button, IconButton, LinkButton } from '../primitives/actions.tsx'
import { Avatar, Badge, Code, CountBadge, Tag } from '../primitives/status.tsx'
import { EmptyState, LoadingState, Notice } from '../primitives/feedback.tsx'
import { Field } from '../primitives/field.tsx'
import { NavList, Tabs } from '../primitives/navigation.tsx'
import { Progress } from '../primitives/progress.tsx'
import { ContentCard, Disclosure, Grid, Inline, Metric, Section, Stack, Surface } from '../layouts/index.tsx'
import { AppShell } from '../layouts/shell.tsx'
import { DataTable } from '../patterns/data-table.tsx'
import { ListChrome } from '../patterns/list-chrome.tsx'
import { BoardPage } from '../patterns/board-page.tsx'
import { DashboardPage } from '../patterns/dashboard-page.tsx'
import { ListPage } from '../patterns/list-page.tsx'
import { FormPage } from '../patterns/form-page.tsx'
import { RecordPage } from '../patterns/record-page.tsx'
import { WorkspacePage } from '../patterns/workspace-page.tsx'
import { ModalSheet } from '../patterns/modal-sheet.tsx'
import { Pipeline } from '../patterns/pipeline.tsx'
import { RecordForm } from '../patterns/record-form.tsx'
import { ActionMenu, Menu } from '../interactions/menu/index.tsx'
import { Popover } from '../interactions/popover/index.tsx'
import { Tooltip } from '../interactions/tooltip/index.tsx'
import { ConfirmDialog, Dialog } from '../interactions/dialog/index.tsx'
import { ToastRegion } from '../interactions/toast/index.tsx'
import { Spinner } from '../interactions/spinner/index.tsx'
import { Skeleton } from '../interactions/skeleton/index.tsx'
import {
  Checkbox,
  CheckboxGroup,
  MoneyField,
  NumberField,
  RadioGroup,
  SearchField,
  Select,
  Switch,
  TextArea,
  TextField,
} from '../forms/scalar-fields/index.tsx'
import { Combobox, MultiCombobox, TagPicker } from '../forms/combobox/index.tsx'
import { DatePicker, DateRangePicker, DateTimePicker, TimePicker } from '../forms/date-time/index.tsx'
import { DropZone, FileUpload } from '../forms/upload/index.tsx'
import { RelationPicker } from '../forms/relation-picker/index.tsx'
import {
  AppliedFilters,
  FilterBar,
  SavedViews,
  SearchBar,
  SortMenu,
  ViewSettings,
} from '../data-operations/list-controls/index.tsx'
import { InlineEdit } from '../data-operations/inline-edit/index.tsx'
import { ResourceList } from '../data-display/resource-list/index.tsx'
import { DataGrid } from '../data-display/data-grid/index.tsx'
import { Tree, TreeGrid } from '../data-display/tree/index.tsx'
import { AvatarGroup, DescriptionList, Person, Status } from '../record/display/index.tsx'
import { FormattedDate, FormattedMoney, FormattedNumber } from '../record/formatted-values/index.tsx'
import { RecordActions, RecordRail, RecordSummary } from '../record/composition/index.tsx'
import { ActivityTimeline, AuditLog } from '../record/activity/index.tsx'
import { Attachments, MediaGallery } from '../record/media/index.tsx'

export type ComponentExample = {
  id: string
  name: string
  description: string
  render: () => JSXChild
}

export type ComponentGroup = {
  id: string
  name: string
  description: string
  examples: readonly ComponentExample[]
}

type OrderRow = {
  id: string
  customer: string
  total: string
  state: 'Ready' | 'Review' | 'Blocked'
}

const orders: OrderRow[] = [
  { id: 'SO-1042', customer: 'Công ty Ánh Dương', total: '18.450.000 ₫', state: 'Ready' },
  { id: 'SO-1041', customer: 'Khách sạn Mùa Hạ', total: '6.800.000 ₫', state: 'Review' },
  { id: 'SO-1039', customer: 'Nguyễn Minh Châu', total: '2.150.000 ₫', state: 'Blocked' },
]

const toneOf = (state: OrderRow['state']) =>
  state === 'Ready' ? ('positive' as const) : state === 'Review' ? ('warning' as const) : ('danger' as const)

type DemoLayout = 'collection' | 'record' | 'flow' | 'canvas'

const demoNavItems = (active: DemoLayout) => [
  { label: 'Collection', href: '#app-shell', leading: '≡', active: active === 'collection', count: 148 },
  { label: 'Record', href: '#record-page', leading: '◇', active: active === 'record' },
  { label: 'Flow', href: '#workspace-flow', leading: '▦', active: active === 'flow', count: 7 },
  { label: 'Canvas', href: '#workspace-canvas', leading: '□', active: active === 'canvas' },
]

const DemoSidebar = (props: { active: DemoLayout }): TemplateResult => (
  <div data-ui="shell-demo-sidebar">
    <strong>KétSuite</strong>
    <NavList label="Workspace layouts" items={demoNavItems(props.active)} />
  </div>
)

const DemoRail = (props: {
  title: string
  detail: string
  progress?: number
  items?: readonly JSXChild[]
}): TemplateResult => (
  <div data-ui="shell-demo-rail">
    <p data-ui="catalogue-kicker">Context</p>
    <strong>{props.title}</strong>
    <p>{props.detail}</p>
    {props.progress !== undefined && <Progress label={props.title} value={props.progress} />}
    {props.items !== undefined && <Stack gap="compact" items={props.items} />}
  </div>
)

const DemoShell = (props: {
  active: DemoLayout
  main: JSXChild
  railTitle?: string
  railDetail?: string
  railProgress?: number
  railItems?: readonly JSXChild[]
}): TemplateResult => (
  <AppShell
    mode="embedded"
    sidebar={<DemoSidebar active={props.active} />}
    main={props.main}
    rightRail={
      props.railTitle !== undefined ? (
        <DemoRail
          title={props.railTitle}
          detail={props.railDetail ?? ''}
          progress={props.railProgress}
          items={props.railItems}
        />
      ) : undefined
    }
  />
)

const OrdersTable = (props: { grouped?: boolean; title?: string } = {}): TemplateResult => (
  <DataTable
    title={props.title}
    rows={props.grouped ? ([] as OrderRow[]) : orders}
    id={(row) => row.id}
    rowHref={(row) => `#${row.id}`}
    responsive="stack"
    selection={{ selectedIds: ['SO-1042'] }}
    groups={
      props.grouped
        ? [
            {
              id: 'ready',
              label: 'Ready to invoice',
              count: 2,
              rows: orders.slice(0, 2),
              pager: { label: '2 shown in Ready', nextHref: '#data-table' },
            },
            {
              id: 'blocked',
              label: 'Needs decision',
              count: 1,
              rows: orders.slice(2),
            },
          ]
        : undefined
    }
    columns={[
      {
        key: 'id',
        label: 'Order',
        cell: (row) => row.id,
        priority: 'primary',
        kind: 'identifier',
        sort: { href: '#data-table', direction: 'descending' },
      },
      { key: 'customer', label: 'Customer', cell: (row) => row.customer },
      { key: 'total', label: 'Total', cell: (row) => row.total, align: 'end', kind: 'currency' },
      {
        key: 'state',
        label: 'State',
        cell: (row) => <Badge label={row.state} tone={toneOf(row.state)} />,
        kind: 'status',
      },
    ]}
  />
)

const ListDemoChrome = (props: { id: string; selected?: number }): TemplateResult => (
  <ListChrome
    search={{
      id: `${props.id}-query`,
      action: `#${props.id}`,
      value: props.id === 'list-page' ? 'Mùa Hạ' : '',
      placeholder: 'Search records',
      hidden: { view: 'table' },
    }}
    facets={[
      { id: 'all', label: 'All', href: `#${props.id}`, active: true, count: 148 },
      { id: 'ready', label: 'Ready', href: `#${props.id}`, count: 91 },
      { id: 'review', label: 'Review', href: `#${props.id}`, count: 7 },
    ]}
    views={[
      { id: 'table', label: 'Table', href: `#${props.id}`, active: true },
      { id: 'kanban', label: 'Kanban', href: `#${props.id}` },
    ]}
    sort={{
      id: `${props.id}-sort`,
      action: `#${props.id}`,
      choices: [
        { value: 'date-desc', label: 'Newest first', selected: true },
        { value: 'total-desc', label: 'Largest total' },
      ],
    }}
    bulk={{
      selectedCount: props.selected ?? 1,
      summary: `${props.selected ?? 1} selected`,
      clearHref: `#${props.id}`,
      actions: [{ id: 'approve', label: 'Approve', name: 'intent', value: 'approve', variant: 'primary' }],
    }}
    pager={{
      summary: 'Showing 1-3 of 148',
      previousHref: null,
      nextHref: `#${props.id}`,
      pages: [
        { label: '1', href: `#${props.id}`, active: true },
        { label: '2', href: `#${props.id}` },
      ],
    }}
  />
)

export const componentGroups: readonly ComponentGroup[] = [
  {
    id: 'actions',
    name: 'Actions',
    description: 'Business hierarchy expressed independently from colour.',
    examples: [
      {
        id: 'button',
        name: 'Button',
        description: 'Primary, secondary, tertiary, destructive, loading and disabled states.',
        render: () => (
          <ActionGroup
            label="Button variants"
            actions={[
              <Button label="Create order" variant="primary" leading="+" />,
              <Button label="Save draft" variant="secondary" />,
              <Button label="More details" variant="tertiary" />,
              <Button label="Terminate" variant="destructive" />,
              <Button label="Saving" loading />,
              <Button label="Unavailable" disabled />,
              <LinkButton label="Opening record" href="#record-page" loading />,
              <IconButton label="Toggle theme" icon="☾" />,
            ]}
          />
        ),
      },
      {
        id: 'action-sizes',
        name: 'Action sizes',
        description: 'Density changes target size without changing hierarchy.',
        render: () => (
          <ActionGroup
            label="Action sizes"
            actions={[
              <Button label="Compact" size="compact" />,
              <Button label="Default" />,
              <Button label="Prominent decision" size="prominent" variant="primary" />,
              <IconButton label="Compact theme toggle" icon="☾" size="compact" />,
              <IconButton label="Prominent theme toggle" icon="☾" size="prominent" />,
              <LinkButton label="Open record" href="#data-table" variant="tertiary" leading="↗" />,
            ]}
          />
        ),
      },
    ],
  },
  {
    id: 'status',
    name: 'Status & identity',
    description: 'Compact objects for operational scanning.',
    examples: [
      {
        id: 'badges',
        name: 'Badge and tag',
        description: 'Tones carry meaning; tags represent categories and active filters.',
        render: () => (
          <Inline
            items={[
              <Badge label="Neutral" />,
              <Badge label="Synchronized" tone="info" />,
              <Badge label="Ready" tone="positive" />,
              <Badge label="Needs review" tone="warning" />,
              <Badge label="Failed" tone="danger" />,
              <Tag label="Hà Nội" removeHref="#status" removeLabel="Remove Hà Nội filter" />,
              <CountBadge count={12} label="12 pending items" />,
            ]}
          />
        ),
      },
      {
        id: 'identity',
        name: 'Avatar and code',
        description: 'Stable fallbacks for people and exact machine-readable values.',
        render: () => (
          <Inline
            items={[
              <Avatar name="Nguyễn Minh Châu" size="small" />,
              <Avatar name="Nguyễn Minh Châu" />,
              <Avatar name="Nguyễn Minh Châu" size="large" />,
              <Code value="tenant-vn-hn-0042" context="tenant" />,
            ]}
          />
        ),
      },
    ],
  },
  {
    id: 'feedback',
    name: 'Feedback',
    description: 'Complete operational states, including the paths nobody screenshots first.',
    examples: [
      {
        id: 'notice',
        name: 'Notice',
        description: 'Status, warning and recovery information with an optional action.',
        render: () => (
          <Stack
            gap="compact"
            items={[
              <Notice title="Sync complete" message="42 records are ready for review." tone="positive" />,
              <Notice title="Release drift" message="Two tenants are one release behind." tone="warning" />,
              <Notice
                title="Connection failed"
                message="The provider rejected the stored credential. Rotate it before retrying."
                tone="danger"
                actions={<Button label="Rotate" size="compact" />}
              />,
            ]}
          />
        ),
      },
      {
        id: 'empty-loading',
        name: 'Empty and loading',
        description: 'Explicit state preserves layout and gives the reader a next step.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <Surface
                padding="none"
                body={
                  <EmptyState
                    title="No saved views"
                    message="Save the current filters to reuse them later."
                    actions={<Button label="Save current view" size="compact" />}
                  />
                }
              />,
              <Surface padding="none" body={<LoadingState label="Loading order history" lines={3} />} />,
            ]}
          />
        ),
      },
    ],
  },
  {
    id: 'fields',
    name: 'Fields',
    description: 'Native controls with one label, help and error contract.',
    examples: [
      {
        id: 'field',
        name: 'Field',
        description: 'Text, select, checkbox and error states without application-owned markup.',
        render: () => (
          <Surface
            body={
              <Grid
                columns={2}
                items={[
                  <Field id="company-name" name="company" label="Company name" value="Két Việt" required />,
                  <Field
                    id="deployment"
                    name="deployment"
                    label="Deployment"
                    type="select"
                    value="commerce"
                    options={[
                      { value: 'commerce', label: 'Commerce' },
                      { value: 'cosmetic', label: 'Cosmetic' },
                      { value: 'hospitality', label: 'Hospitality' },
                    ]}
                    help="A tenant belongs to exactly one deployment."
                  />,
                  <Field
                    id="database-key"
                    name="databaseKey"
                    label="Database key"
                    value="Invalid Key"
                    error="Use lowercase letters, numbers and hyphens only."
                  />,
                  <Field
                    id="active"
                    name="active"
                    label="Active for new orders"
                    type="checkbox"
                    value
                    help="New orders can be assigned to this company."
                  />,
                ]}
              />
            }
          />
        ),
      },
    ],
  },
  {
    id: 'field-states',
    name: 'Field states',
    description: 'Native input types, validation, read-only values and nested groups.',
    examples: [
      {
        id: 'advanced-fields',
        name: 'Operational fields',
        description: 'Numeric constraints, dates, options and nested validation use the same field contract.',
        render: () => (
          <Surface
            title="Settings"
            body={
              <RecordForm
                action="#advanced-fields"
                submitLabel="Save settings"
                fields={[
                  {
                    id: 'settings-reference',
                    name: 'reference',
                    label: 'Reference',
                    value: 'CUS-0042',
                    readOnly: true,
                    help: 'Assigned when the account was created.',
                  },
                  {
                    id: 'settings-locked',
                    name: 'locked',
                    label: 'External reference',
                    value: 'Pending verification',
                    disabled: true,
                  },
                  {
                    id: 'settings-limit',
                    name: 'limit',
                    label: 'Credit limit',
                    type: 'decimal',
                    value: 80000000,
                    min: 0,
                    step: '1000',
                  },
                  {
                    id: 'settings-date',
                    name: 'date',
                    label: 'Effective date',
                    type: 'date',
                    value: '2026-09-08',
                  },
                  { id: 'settings-time', name: 'time', label: 'Delivery time', type: 'time', value: '09:00' },
                  {
                    id: 'settings-color',
                    name: 'color',
                    label: 'Calendar colour',
                    type: 'color',
                    value: '#5167c4',
                  },
                  {
                    id: 'settings-billing',
                    name: 'billing',
                    label: 'Billing frequency',
                    type: 'radio',
                    value: 'monthly',
                    required: true,
                    options: [
                      { value: 'monthly', label: 'Monthly' },
                      { value: 'quarterly', label: 'Quarterly' },
                    ],
                  },
                  {
                    id: 'settings-channels',
                    name: 'channels',
                    label: 'Notifications',
                    type: 'checkbox-group',
                    options: [
                      { value: 'email', label: 'Email', checked: true },
                      { value: 'sms', label: 'SMS' },
                    ],
                  },
                  {
                    id: 'settings-address',
                    name: 'address',
                    label: 'Delivery address',
                    error: 'Check the delivery address.',
                    fields: [
                      {
                        id: 'settings-street',
                        name: 'street',
                        label: 'Street',
                        value: '',
                        required: true,
                        error: 'Enter a street address.',
                        span: 'full',
                      },
                      {
                        id: 'settings-city',
                        name: 'city',
                        label: 'City',
                        value: 'Hồ Chí Minh',
                        autocomplete: 'address-level2',
                      },
                    ],
                  },
                ]}
              />
            }
          />
        ),
      },
    ],
  },
  {
    id: 'layouts',
    name: 'Layouts',
    description: 'Quiet hierarchy for dense application screens.',
    examples: [
      {
        id: 'surface-section',
        name: 'Surface and section',
        description: 'Layout components establish rhythm without domain assumptions.',
        render: () => (
          <Section
            eyebrow="Operations"
            title="Daily overview"
            description="The section owns hierarchy; its body remains application data."
            actions={<LinkButton label="View report" href="#patterns" size="compact" />}
            body={
              <Grid
                columns={4}
                items={[
                  <Metric
                    label="Orders"
                    value="148"
                    detail="+12 today"
                    tone="positive"
                    icon={
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.75"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M3 6h18v12H3z" />
                        <circle cx="12" cy="12" r="2.5" />
                      </svg>
                    }
                  />,
                  <Metric
                    label="Review queue"
                    value="7"
                    detail="Oldest 42 min"
                    tone="warning"
                    href="#surface-section"
                  />,
                  <Metric label="Blocked" value="2" detail="Credential required" tone="danger" />,
                  <Metric label="Archived" value="1 204" detail="No state to report" />,
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'content-card',
        name: 'Content card',
        description: 'A composable record summary with valid nested actions.',
        render: () => (
          <Grid
            columns={3}
            items={[
              <ContentCard
                title="Commerce"
                summary="General retail operations"
                body="24 ready tenants"
                meta={<Badge label="Stable" tone="positive" />}
                href="#content-card"
              />,
              <ContentCard
                title="Cosmetic"
                summary="Care and marketplace workflows"
                body="9 ready tenants"
                meta={<Badge label="Review" tone="warning" />}
                selected
              />,
              <ContentCard
                title="Hospitality"
                summary="Property and OTA operations"
                body="6 ready tenants"
                actions={<Button label="Open cohort" size="compact" />}
              />,
            ]}
          />
        ),
      },
      {
        id: 'disclosure',
        name: 'Disclosure',
        description: 'Secondary detail stays available without dominating the primary workflow.',
        render: () => (
          <Disclosure
            summary="Permission provenance"
            body={
              <Stack
                gap="compact"
                items={[
                  <Code value="sales.order.approve" context="managed-template" />,
                  <Code value="sales.order.read" context="managed-template" />,
                ]}
              />
            }
          />
        ),
      },
    ],
  },
  {
    id: 'application-structure',
    name: 'Application structure',
    description:
      'Four practical layouts inside the same shell: collection, record, flow workspace and canvas workspace.',
    examples: [
      {
        id: 'app-shell',
        name: 'Collection shell',
        description:
          'A full list workspace with sidebar navigation, URL-owned list chrome, selectable rows and a context rail.',
        render: () => (
          <DemoShell
            active="collection"
            main={
              <ListPage
                variant="operational"
                context="Sales / Sales orders"
                title="Sales orders"
                description="Review demand, fulfillment and payment state from one operational list."
                actions={<Button label="Create order" variant="primary" />}
                controls={<ListDemoChrome id="app-shell" />}
                body={<OrdersTable title="Order list" />}
              />
            }
            railTitle="List health"
            railDetail="Seven orders need a human decision before invoicing."
            railProgress={72}
            railItems={[
              <Badge label="91 ready" tone="positive" />,
              <Badge label="7 review" tone="warning" />,
            ]}
          />
        ),
      },
      {
        id: 'record-page',
        name: 'Record shell',
        description:
          'A durable subject with record identity, tabs, form content and a right-hand facts rail.',
        render: () => (
          <DemoShell
            active="record"
            main={
              <RecordPage
                variant="operational"
                context="Customers / Mùa Hạ Riverside"
                title="Mùa Hạ Riverside"
                description="Customer · CUS-0042"
                status={<Badge label="Active" tone="positive" />}
                actions={
                  <ActionGroup
                    actions={[
                      <Button label="Save" variant="primary" size="compact" />,
                      <Button label="Archive" variant="tertiary" size="compact" />,
                    ]}
                  />
                }
                navigation={
                  <Tabs
                    label="Customer record"
                    items={[
                      { id: 'details', label: 'Details', href: '#record-page', active: true },
                      { id: 'orders', label: 'Orders', href: '#record-page', count: 6 },
                      { id: 'activity', label: 'Activity', href: '#record-page', count: 8 },
                    ]}
                  />
                }
                body={
                  <Stack
                    items={[
                      <Surface
                        title="Main information"
                        body={
                          <RecordForm
                            action="#record-page"
                            fields={[
                              {
                                id: 'layout-partner-name',
                                span: 'full',
                                name: 'name',
                                label: 'Name',
                                value: 'Mùa Hạ Riverside',
                              },
                              {
                                id: 'layout-partner-email',
                                span: 'full',
                                name: 'email',
                                label: 'Email',
                                type: 'email',
                                value: 'hello@muaha.example',
                              },
                              {
                                id: 'layout-partner-tags',
                                name: 'tags',
                                label: 'Tags',
                                type: 'checkbox-group',
                                span: 'full',
                                options: [
                                  { value: 'vip', label: 'VIP', checked: true },
                                  { value: 'hospitality', label: 'Hospitality', checked: true },
                                ],
                              },
                            ]}
                            submitLabel="Save"
                          />
                        }
                      />,
                      <OrdersTable title="Recent orders" />,
                    ]}
                  />
                }
                aside={
                  <Stack
                    items={[
                      <Metric label="Credit limit" value="80m ₫" detail="42m ₫ available" />,
                      <Progress label="Onboarding complete" value={84} tone="positive" />,
                    ]}
                  />
                }
                asideLabel="Customer context"
              />
            }
          />
        ),
      },
      {
        id: 'workspace-flow',
        name: 'Flow workspace',
        description:
          'A vertical operations overview where metrics, process state and exception lists sit on one grey canvas.',
        render: () => (
          <DemoShell
            active="flow"
            main={
              <WorkspacePage
                variant="operational"
                layout="flow"
                context="Sales / Overview"
                title="Revenue operations"
                description="Follow confirmed demand, open work and handoffs across the team."
                actions={<Button label="Create quotation" variant="primary" />}
                controls={
                  <ActionGroup
                    label="Flow controls"
                    actions={[
                      <LinkButton label="Today" href="#workspace-flow" size="compact" />,
                      <LinkButton
                        label="This week"
                        href="#workspace-flow"
                        size="compact"
                        variant="tertiary"
                      />,
                    ]}
                  />
                }
                body={
                  <Stack
                    gap="loose"
                    items={[
                      <Grid
                        columns={4}
                        items={[
                          <Metric label="Quotations" value={24} detail="5 new today" />,
                          <Metric label="Sent" value={9} detail="Awaiting reply" tone="info" />,
                          <Metric label="Confirmed" value={18} detail="82,000,000 ₫" tone="positive" />,
                          <Metric label="Blocked" value={2} detail="Needs attention" tone="danger" />,
                        ]}
                      />,
                      <Surface
                        title="Sales flow"
                        body={
                          <Pipeline
                            label="Sales flow"
                            steps={[
                              { id: 'draft', label: 'Quotation', value: 24 },
                              { id: 'sent', label: 'Sent', value: 9, tone: 'info' },
                              { id: 'confirmed', label: 'Confirmed', value: 18, tone: 'positive' },
                              { id: 'invoice', label: 'To invoice', value: 6, tone: 'warning' },
                            ]}
                          />
                        }
                      />,
                      <OrdersTable grouped title="Exceptions" />,
                    ]}
                  />
                }
              />
            }
            railTitle="Daily target"
            railDetail="56 of 82 confirmed orders have been invoiced today."
            railProgress={68}
          />
        ),
      },
      {
        id: 'workspace-canvas',
        name: 'Canvas workspace',
        description:
          'A horizontal board-style surface where the main content can scroll without changing the shell.',
        render: () => (
          <DemoShell
            active="canvas"
            main={
              <WorkspacePage
                variant="operational"
                layout="canvas"
                context="CRM / Pipeline"
                title="Opportunities board"
                description="Move active opportunities through a spatial workflow."
                actions={<Button label="Create opportunity" variant="primary" />}
                controls={
                  <Inline
                    items={[
                      <LinkButton label="My pipeline" href="#workspace-canvas" size="compact" />,
                      <LinkButton
                        label="All teams"
                        href="#workspace-canvas"
                        size="compact"
                        variant="tertiary"
                      />,
                      <Tag label="High value" removeHref="#workspace-canvas" removeLabel="Remove filter" />,
                    ]}
                  />
                }
                body={
                  <Grid
                    columns={3}
                    items={[
                      <Section
                        title="Qualified"
                        body={
                          <Stack
                            gap="compact"
                            items={[
                              <ContentCard
                                title="Mùa Hạ Riverside"
                                meta="42,000,000 ₫"
                                body="Needs proposal"
                              />,
                              <ContentCard title="Ánh Dương Group" meta="18,000,000 ₫" body="Demo booked" />,
                            ]}
                          />
                        }
                      />,
                      <Section
                        title="Proposal"
                        body={
                          <Stack
                            gap="compact"
                            items={[
                              <ContentCard title="Lotus Hotels" meta="64,000,000 ₫" body="Awaiting CFO" />,
                              <ContentCard
                                title="Bình Minh Retail"
                                meta="30,000,000 ₫"
                                body="Legal review"
                              />,
                            ]}
                          />
                        }
                      />,
                      <Section
                        title="Negotiation"
                        body={
                          <Stack
                            gap="compact"
                            items={[
                              <ContentCard title="Sông Xanh" meta="52,000,000 ₫" body="Discount requested" />,
                              <ContentCard title="Urban Stay" meta="40,000,000 ₫" body="Close this week" />,
                            ]}
                          />
                        }
                      />,
                    ]}
                  />
                }
              />
            }
            railTitle="Pipeline risk"
            railDetail="Three opportunities need owner follow-up before Friday."
            railItems={[
              <Badge label="2 overdue" tone="danger" />,
              <Badge label="6 due this week" tone="warning" />,
            ]}
          />
        ),
      },
    ],
  },
  {
    id: 'navigation',
    name: 'Navigation & progress',
    description: 'Low-luminance selection and compact progress keep attention on the working content.',
    examples: [
      {
        id: 'navigation-items',
        name: 'Navigation and tabs',
        description: 'The active indigo remains restrained in both vertical and horizontal navigation.',
        render: () => (
          <Stack
            items={[
              <NavList
                label="Product"
                items={[
                  { label: 'Details', href: '#navigation-items', leading: '◇', active: true },
                  { label: 'Variants', href: '#navigation-items', leading: '□', count: 12 },
                  { label: 'Inventory', href: '#navigation-items', leading: '≡' },
                ]}
              />,
              <Tabs
                label="Record views"
                items={[
                  { id: 'summary', label: 'Summary', href: '#navigation-items', active: true },
                  { id: 'activity', label: 'Activity', href: '#navigation-items', count: 8 },
                  { id: 'files', label: 'Files', href: '#navigation-items', count: 3 },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'progress',
        name: 'Progress',
        description: 'A four-pixel track communicates state without becoming another panel.',
        render: () => (
          <Stack
            gap="compact"
            items={[
              <Progress label="Project completion" value={68} />,
              <Progress label="Approved" value={92} tone="positive" />,
              <Progress label="At risk" value={54} tone="warning" />,
              <Progress label="Overdue" value={31} tone="danger" />,
            ]}
          />
        ),
      },
    ],
  },
  {
    id: 'patterns',
    name: 'Patterns',
    description: 'Generic workflows assembled from the same primitives.',
    examples: [
      {
        id: 'list-chrome',
        name: 'List chrome',
        description: 'Search, filters, view switch, bulk state and paging for URL-driven collection screens.',
        render: () => (
          <ListChrome
            search={{
              id: 'customer-query',
              action: '#list-chrome',
              placeholder: 'Search customers',
            }}
            facets={[
              { id: 'active', label: 'Active', href: '#list-chrome', active: true, count: 42 },
              { id: 'draft', label: 'Draft', href: '#list-chrome', count: 6 },
            ]}
            views={[
              { id: 'table', label: 'Table', href: '#list-chrome', active: true },
              { id: 'cards', label: 'Cards', href: '#list-chrome' },
            ]}
            sort={{
              id: 'customer-sort',
              action: '#list-chrome',
              choices: [
                { value: 'updated-desc', label: 'Recently updated', selected: true },
                { value: 'name-asc', label: 'Name A-Z' },
              ],
            }}
            status="48 customers"
            actions={<Button label="Create" variant="primary" size="compact" />}
            bulk={{
              selectedCount: 2,
              summary: '2 customers selected',
              clearHref: '#list-chrome',
              actions: [{ id: 'archive', label: 'Archive', name: 'intent', value: 'archive' }],
            }}
            pager={{
              summary: 'Showing 1-25 of 48',
              nextHref: '#list-chrome',
              pages: [
                { label: '1', href: '#list-chrome', active: true },
                { label: '2', href: '#list-chrome' },
              ],
            }}
          />
        ),
      },
      {
        id: 'list-page',
        name: 'List page',
        description:
          'The canonical collection hierarchy: identity, actions, URL-driven controls, result context and records.',
        render: () => (
          <ListPage
            variant="operational"
            context="Sales / Sales orders"
            eyebrow="Sales"
            title="Sales orders"
            description="Review demand, fulfillment and payment state from one operational list."
            actions={<Button label="Create order" variant="primary" />}
            controls={
              <ListChrome
                search={{
                  id: 'orders-query',
                  action: '#list-page',
                  value: 'Mùa Hạ',
                  placeholder: 'Search orders',
                  hidden: { view: 'all' },
                }}
                facets={[
                  { id: 'all', label: 'All', href: '#list-page', active: true, count: 148 },
                  { id: 'ready', label: 'Ready', href: '#list-page', count: 91 },
                  { id: 'review', label: 'Review', href: '#list-page', count: 7 },
                ]}
                views={[
                  { id: 'table', label: 'Table', href: '#list-page', active: true },
                  { id: 'kanban', label: 'Kanban', href: '#list-page' },
                ]}
                sort={{
                  id: 'orders-sort',
                  action: '#list-page',
                  choices: [
                    { value: 'date-desc', label: 'Newest first', selected: true },
                    { value: 'total-desc', label: 'Largest total' },
                    { value: 'customer-asc', label: 'Customer A-Z' },
                  ],
                }}
                bulk={{
                  selectedCount: 1,
                  summary: '1 order selected',
                  clearHref: '#list-page',
                  actions: [
                    { id: 'approve', label: 'Approve', name: 'intent', value: 'approve', variant: 'primary' },
                    { id: 'export', label: 'Export', name: 'intent', value: 'export' },
                  ],
                }}
                pager={{
                  summary: 'Showing 1-3 of 148',
                  previousHref: null,
                  nextHref: '#list-page',
                  pages: [
                    { label: '1', href: '#list-page', active: true },
                    { label: '2', href: '#list-page' },
                    { label: '3', href: '#list-page' },
                  ],
                }}
              />
            }
            body={
              <DataTable
                title="Order list"
                rows={orders}
                id={(row) => row.id}
                rowHref={(row) => `#${row.id}`}
                responsive="stack"
                selection={{ selectedIds: ['SO-1042'] }}
                columns={[
                  {
                    key: 'id',
                    label: 'Order',
                    cell: (row) => row.id,
                    priority: 'primary',
                    kind: 'identifier',
                    sort: { href: '#list-page', direction: 'descending' },
                  },
                  { key: 'customer', label: 'Customer', cell: (row) => row.customer },
                  { key: 'total', label: 'Total', cell: (row) => row.total, align: 'end', kind: 'currency' },
                  {
                    key: 'state',
                    label: 'State',
                    cell: (row) => <Badge label={row.state} tone={toneOf(row.state)} />,
                    kind: 'status',
                  },
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'dashboard-page',
        name: 'Dashboard page',
        description:
          'The canonical overview hierarchy: durable context, compact identity, primary action and an uninterrupted analytical canvas.',
        render: () => (
          <DashboardPage
            variant="operational"
            context="Sales / Overview"
            eyebrow="Commercial workspace"
            title="Sales overview"
            description="Follow demand, confirmed revenue and the work waiting for the team."
            actions={<Button label="Create quotation" variant="primary" />}
            body={
              <Stack
                gap="loose"
                items={[
                  <Grid
                    columns={4}
                    items={[
                      <Metric label="Quotations" value={24} detail="5 new today" />,
                      <Metric label="Sent" value={9} detail="Awaiting a reply" tone="info" />,
                      <Metric label="Confirmed" value={18} detail="82,000,000 ₫" tone="positive" />,
                      <Metric label="To invoice" value={6} detail="Needs attention" tone="warning" />,
                    ]}
                  />,
                  <Surface
                    title="Sales flow"
                    body={
                      <Pipeline
                        label="Sales flow"
                        steps={[
                          { id: 'draft', label: 'Quotation', value: 24 },
                          { id: 'sent', label: 'Sent', value: 9, tone: 'info' },
                          { id: 'confirmed', label: 'Confirmed', value: 18, tone: 'positive' },
                          { id: 'invoice', label: 'To invoice', value: 6, tone: 'warning' },
                        ]}
                      />
                    }
                  />,
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'board-page',
        name: 'Board page',
        description:
          'The canonical horizontal workspace: durable context, compact identity, global controls and an uninterrupted board canvas.',
        render: () => (
          <BoardPage
            variant="operational"
            context="CRM / Pipeline"
            eyebrow="Pipeline"
            title="Sales opportunities"
            description="Move active opportunities through the sales process."
            actions={<Button label="Create opportunity" variant="primary" />}
            controls={
              <ActionGroup
                label="Board controls"
                actions={[
                  <LinkButton label="My opportunities" href="#board-page" size="compact" />,
                  <LinkButton label="All teams" href="#board-page" size="compact" variant="tertiary" />,
                ]}
              />
            }
            body={
              <Grid
                columns={3}
                items={[
                  <ContentCard title="Qualified" meta="8 opportunities" body="125,000,000 ₫" />,
                  <ContentCard title="Proposal" meta="5 opportunities" body="94,000,000 ₫" />,
                  <ContentCard title="Negotiation" meta="3 opportunities" body="62,000,000 ₫" />,
                ]}
              />
            }
          />
        ),
      },
      {
        id: 'pipeline',
        name: 'Pipeline',
        description:
          'Stages of a process and the work sitting in each. A later stage may hold more than the one before it.',
        render: () => (
          <Pipeline
            label="Order pipeline"
            steps={[
              { id: 'draft', label: 'Draft', value: 24, href: '#pipeline' },
              { id: 'sent', label: 'Sent', value: 9, href: '#pipeline', tone: 'info' },
              { id: 'confirmed', label: 'Confirmed', value: 18, href: '#pipeline', tone: 'positive' },
              { id: 'to-invoice', label: 'To invoice', value: 6, href: '#pipeline', tone: 'warning' },
            ]}
          />
        ),
      },
      {
        id: 'data-table',
        name: 'Data table',
        description: 'Columns are data; rows remain semantic and horizontally contained.',
        render: () => (
          <DataTable
            title="Recent sales orders"
            actions={<LinkButton label="View all orders" href="#app-shell" variant="tertiary" />}
            rows={[] as OrderRow[]}
            id={(row) => row.id}
            rowHref={(row) => `#${row.id}`}
            responsive="stack"
            gutter="compact"
            selection={{ selectedIds: ['SO-1042'] }}
            groups={[
              {
                id: 'ready',
                label: 'Ready to invoice',
                count: 2,
                href: '#data-table',
                rows: orders.slice(0, 2),
                pager: { label: '2 shown in Ready', nextHref: '#data-table' },
              },
              {
                id: 'blocked',
                label: 'Needs decision',
                count: 1,
                rows: orders.slice(2),
              },
            ]}
            columns={[
              {
                key: 'id',
                label: 'Order',
                cell: (row) => row.id,
                priority: 'primary',
                kind: 'identifier',
                sort: { href: '#data-table', direction: 'descending' },
              },
              { key: 'customer', label: 'Customer', cell: (row) => row.customer },
              { key: 'total', label: 'Total', cell: (row) => row.total, align: 'end', kind: 'currency' },
              {
                key: 'state',
                label: 'State',
                cell: (row) => <Badge label={row.state} tone={toneOf(row.state)} />,
                kind: 'status',
              },
            ]}
          />
        ),
      },
      {
        id: 'form-page',
        name: 'Form page',
        description:
          'The canonical form hierarchy: record identity and decision first, a stable form column, then durable context.',
        render: () => (
          <FormPage
            variant="operational"
            context="Customers / Mùa Hạ Riverside"
            title="Mùa Hạ Riverside"
            description="Customer · CUS-0042"
            status={<Badge label="Active" tone="positive" />}
            actions={<Button label="Save partner" variant="primary" />}
            body={
              <Surface
                title="Main information"
                body={
                  <RecordForm
                    action="#form-page"
                    fields={[
                      { id: 'partner-name', name: 'name', label: 'Name', value: 'Mùa Hạ Riverside' },
                      { id: 'partner-ref', name: 'ref', label: 'Reference', value: 'CUS-0042' },
                      {
                        id: 'partner-email',
                        name: 'email',
                        label: 'Email',
                        type: 'email',
                        value: 'hello@muaha.example',
                      },
                      {
                        id: 'partner-phone',
                        name: 'phone',
                        label: 'Phone',
                        type: 'tel',
                        value: '+84 28 3822 0042',
                      },
                    ]}
                    submitLabel="Save partner"
                  />
                }
              />
            }
            aside={
              <Section
                title="Record context"
                body={<Stack gap="compact" items={['Customer since 2023', '6 delivery addresses']} />}
              />
            }
            asideLabel="Partner context"
          />
        ),
      },
      {
        id: 'record-form',
        name: 'Record form',
        description: 'Application supplies translated labels and values, not form markup.',
        render: () => (
          <Surface
            title="Main information"
            body={
              <RecordForm
                action="#record-form"
                fields={[
                  { id: 'record-name', name: 'name', label: 'Display name', value: 'Mùa Hạ Riverside' },
                  {
                    id: 'record-status',
                    name: 'status',
                    label: 'Lifecycle',
                    type: 'select',
                    value: 'ready',
                    options: [
                      { value: 'draft', label: 'Draft' },
                      { value: 'ready', label: 'Ready' },
                    ],
                  },
                  {
                    id: 'record-note',
                    name: 'note',
                    label: 'Internal note',
                    type: 'textarea',
                    value: 'Migration approved by the operations team.',
                    span: 'full',
                  },
                ]}
                submitLabel="Save record"
                cancelHref="#patterns"
                cancelLabel="Cancel"
              />
            }
          />
        ),
      },
      {
        id: 'modal-sheet',
        name: 'Modal sheet',
        description: 'Shown embedded here; the production mode occupies the viewport.',
        render: () => (
          <ModalSheet
            id="release-drift-modal"
            mode="embedded"
            title="Resolve release drift"
            closeHref="#modal-sheet"
            closeLabel="Close modal"
            body={
              <Stack
                items={[
                  <Notice
                    title="Two tenants are behind"
                    message="Migration runs separately for each database and preserves failed tenants for retry."
                    tone="warning"
                  />,
                  <ActionGroup
                    actions={[
                      <Button label="Start migration" variant="primary" />,
                      <LinkButton label="Review plan" href="#data-table" variant="tertiary" />,
                    ]}
                  />,
                ]}
              />
            }
          />
        ),
      },
    ],
  },
  {
    id: 'interactions',
    name: 'Interaction essentials',
    description: 'Controlled SSR state with native fallbacks and one optional runtime adapter.',
    examples: [
      {
        id: 'menu',
        name: 'Menu and action menu',
        description: 'Native disclosure supports links, submit actions, descriptions and disabled state.',
        render: () => (
          <Inline
            items={[
              <Menu
                id="record-menu"
                label="Record actions"
                open
                items={[
                  { id: 'open', label: 'Open record', href: '#record-page' },
                  { id: 'duplicate', label: 'Duplicate', value: 'duplicate' },
                  { id: 'archive', label: 'Archive', value: 'archive', destructive: true },
                ]}
              />,
              <ActionMenu
                id="more-actions"
                label="More actions"
                items={[{ id: 'export', label: 'Export report', href: '#data-table' }]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'popover',
        name: 'Popover and tooltip',
        description: 'Popover state remains URL-owned; tooltips contain descriptive text only.',
        render: () => (
          <Inline
            items={[
              <Popover
                id="owner-popover"
                label="Record owner"
                trigger={<Badge label="Show owner" />}
                body={<p>Nguyễn Ngọc Linh · Sales operations</p>}
                open
                openHref="#popover"
                closeHref="#popover"
                closeLabel="Close owner details"
              />,
              <Tooltip
                id="sync-tip"
                text="Last synchronized two minutes ago"
                trigger={<Badge label="Synced" tone="positive" />}
              />,
            ]}
          />
        ),
      },
      {
        id: 'dialog',
        name: 'Dialog and confirmation',
        description: 'Named modal semantics with native close and submit paths.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <Dialog
                id="details-dialog"
                mode="embedded"
                title="Review assignment"
                description="The current owner keeps access."
                closeHref="#dialog"
                closeLabel="Close dialog"
                body={<p>Assign this record to the operations queue.</p>}
              />,
              <ConfirmDialog
                id="archive-dialog"
                mode="embedded"
                title="Archive record?"
                message="The record leaves active worklists but remains available in history."
                closeHref="#dialog"
                closeLabel="Cancel"
                confirmLabel="Archive"
              />,
            ]}
          />
        ),
      },
      {
        id: 'feedback-runtime',
        name: 'Transient feedback and loading',
        description: 'Live-region toasts, compact progress and content skeletons share state rules.',
        render: () => (
          <Stack
            items={[
              <Inline items={[<Spinner label="Saving record" />, <span>Saving record</span>]} />,
              <Skeleton label="Loading customer summary" lines={3} />,
              <ToastRegion
                label="Notifications"
                toasts={[
                  {
                    id: 'saved',
                    title: 'Record saved',
                    message: 'All changes are synchronized.',
                    tone: 'positive',
                  },
                ]}
              />,
            ]}
          />
        ),
      },
    ],
  },
  {
    id: 'form-controls',
    name: 'Form controls and pickers',
    description: 'Typed, server-rendered controls preserve user input and native submission semantics.',
    examples: [
      {
        id: 'scalar-fields',
        name: 'Scalar fields',
        description: 'Text, long text, search, exact numeric and money values share one field contract.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <TextField id="customer" name="customer" label="Customer" value="An Việt" required />,
              <SearchField id="reference" name="reference" label="Reference" value="SO-1042" />,
              <NumberField id="quantity" name="quantity" label="Quantity" value="12" min="0" />,
              <MoneyField id="total" name="total" label="Total" value="18450000.00" />,
              <TextArea
                id="note"
                name="note"
                label="Internal note"
                value="Deliver before 17:00."
                span="full"
              />,
            ]}
          />
        ),
      },
      {
        id: 'selection-controls',
        name: 'Selection controls',
        description: 'Native checkbox, group, radio, switch and select states remain submit-capable.',
        render: () => (
          <Stack
            items={[
              <Checkbox id="priority" name="priority" label="Priority order" value />,
              <CheckboxGroup
                id="channels"
                name="channels"
                label="Channels"
                options={[
                  { value: 'email', label: 'Email', checked: true },
                  { value: 'sms', label: 'SMS' },
                ]}
              />,
              <RadioGroup
                id="delivery"
                name="delivery"
                label="Delivery"
                value="standard"
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'express', label: 'Express' },
                ]}
              />,
              <Switch id="notify" name="notify" label="Notify owner" checked />,
              <Select
                id="warehouse"
                name="warehouse"
                label="Warehouse"
                value="hn"
                options={[
                  { value: 'hn', label: 'Hà Nội' },
                  { value: 'hcm', label: 'Hồ Chí Minh' },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'comboboxes',
        name: 'Combobox and tags',
        description: 'Query, open state and selected values remain controlled by URL or application state.',
        render: () => {
          const options = [
            { value: 'linh', label: 'Ngọc Linh', description: 'Sales operations' },
            { value: 'minh', label: 'Minh Anh', description: 'Fulfilment' },
          ]
          return (
            <Stack
              items={[
                <Combobox
                  id="owner"
                  name="owner"
                  label="Owner"
                  query="Ngọc"
                  value="linh"
                  options={options}
                  open
                  openHref="#comboboxes"
                  closeHref="#comboboxes"
                />,
                <MultiCombobox
                  id="watchers"
                  name="watchers"
                  label="Watchers"
                  query=""
                  options={options}
                  values={['linh']}
                  open={false}
                  openHref="#comboboxes"
                  closeHref="#comboboxes"
                  removeHref={() => '#comboboxes'}
                />,
                <TagPicker
                  id="tags"
                  name="tags"
                  label="Tags"
                  query=""
                  options={[{ value: 'urgent', label: 'Urgent' }]}
                  values={['urgent']}
                  open={false}
                  openHref="#comboboxes"
                  closeHref="#comboboxes"
                  removeHref={() => '#comboboxes'}
                />,
              ]}
            />
          )
        },
      },
      {
        id: 'date-time',
        name: 'Civil date and local time',
        description: 'Civil dates and local times submit their source text without implicit UTC conversion.',
        render: () => (
          <Stack
            items={[
              <DatePicker id="date" name="date" label="Delivery date" value="2026-09-08" />,
              <DateRangePicker
                id="range"
                label="Reporting period"
                start={{ id: 'from', name: 'from', value: '2026-09-01' }}
                end={{ id: 'to', name: 'to', value: '2026-09-30' }}
                startLabel="From"
                endLabel="To"
              />,
              <DateTimePicker
                id="appointment"
                name="appointment"
                label="Appointment"
                value="2026-09-08T14:30"
              />,
              <TimePicker id="cutoff" name="cutoff" label="Cut-off" value="17:00" />,
            ]}
          />
        ),
      },
      {
        id: 'uploads',
        name: 'File upload and drop zone',
        description: 'Native file input owns submission; the application owns transport and storage.',
        render: () => (
          <Stack
            items={[
              <FileUpload id="invoice" name="invoice" label="Invoice" accept="application/pdf" />,
              <DropZone
                id="photos"
                name="photos"
                label="Delivery photos"
                accept="image/*"
                multiple
                status="Up to 10 files · 8 MB each"
              />,
            ]}
          />
        ),
      },
      {
        id: 'relation-picker',
        name: 'Relation picker',
        description: 'The renderer only receives permission-filtered records from the application adapter.',
        render: () => (
          <RelationPicker
            id="partner"
            name="partner"
            label="Partner"
            query="An"
            value="an-viet"
            results={[
              { id: 'an-viet', name: 'An Việt', city: 'Hà Nội' },
              { id: 'anh-duong', name: 'Ánh Dương', city: 'Đà Nẵng' },
            ]}
            getValue={(partner) => partner.id}
            getLabel={(partner) => partner.name}
            getDescription={(partner) => partner.city}
            open
            openHref="#relation-picker"
            closeHref="#relation-picker"
          />
        ),
      },
    ],
  },
  {
    id: 'data-operations',
    name: 'Data operations',
    description: 'URL-owned collection controls and bounded data renderers for operational work.',
    examples: [
      {
        id: 'collection-controls',
        name: 'Search, filter and sort',
        description: 'Every control has a canonical URL and preserves unrelated query state.',
        render: () => (
          <Stack
            items={[
              <SearchBar action="/orders" value="An Việt" hidden={{ state: 'open' }} />,
              <FilterBar
                filters={[
                  <LinkButton href="/orders?state=open" label="Open" size="compact" />,
                  <LinkButton href="/orders?owner=me" label="My records" size="compact" />,
                  <SortMenu
                    id="sort-orders"
                    choices={[
                      {
                        id: 'updated',
                        label: 'Recently updated',
                        href: '/orders?sort=updated',
                        active: true,
                      },
                      { id: 'value', label: 'Highest value', href: '/orders?sort=value' },
                    ]}
                  />,
                ]}
              />,
              <AppliedFilters
                filters={[
                  { id: 'state', label: 'State', value: 'Open', removeHref: '/orders?q=An+Việt' },
                  { id: 'owner', label: 'Owner', value: 'Me', removeHref: '/orders?state=open' },
                ]}
                clearHref="/orders"
              />,
            ]}
          />
        ),
      },
      {
        id: 'saved-views',
        name: 'Saved views and settings',
        description:
          'The renderer carries version tokens while the application owns persistence and permission.',
        render: () => (
          <Stack
            items={[
              <SavedViews
                views={[
                  {
                    id: 'all',
                    label: 'All orders',
                    href: '/orders',
                    active: true,
                    description: '148 records',
                  },
                  {
                    id: 'review',
                    label: 'Needs review',
                    href: '/orders?view=review',
                    description: '7 records',
                  },
                ]}
              />,
              <ViewSettings
                id="order-view"
                action="/orders/views"
                version="7"
                settings={[
                  { id: 'customer', label: 'Customer', visible: true, disabled: true },
                  { id: 'total', label: 'Total', visible: true },
                  { id: 'owner', label: 'Owner', visible: false },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'resource-list',
        name: 'Resource list',
        description: 'One keyboard link per row with optional selection and paging composition.',
        render: () => (
          <ResourceList
            label="Orders"
            rows={orders}
            id={(row) => row.id}
            href={(row) => `/orders/${row.id}`}
            primary={(row) => `${row.id} · ${row.customer}`}
            secondary={(row) => row.total}
            meta={(row) => <Badge label={row.state} tone={toneOf(row.state)} />}
            selectedIds={['SO-1042']}
            pager={{ summary: '1–3 of 148', nextHref: '/orders?page=2' }}
          />
        ),
      },
      {
        id: 'data-grid',
        name: 'Bounded data grid',
        description:
          'Column order, visibility and pinning are explicit; row rendering is capped before virtualization.',
        render: () => (
          <DataGrid
            label="Order analysis"
            rows={orders}
            id={(row) => row.id}
            maxRows={500}
            columns={[
              { key: 'id', label: 'Order', cell: (row) => row.id, pinned: 'start', width: '8rem' },
              { key: 'customer', label: 'Customer', cell: (row) => row.customer, width: '18rem' },
              { key: 'total', label: 'Total', cell: (row) => row.total, width: '10rem' },
              { key: 'state', label: 'State', cell: (row) => row.state, width: '9rem' },
            ]}
          />
        ),
      },
      {
        id: 'tree',
        name: 'Tree and tree grid',
        description:
          'Hierarchy uses native links; tabular hierarchy is reserved for independent multi-column data.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <Tree
                label="Workspace pages"
                nodes={[
                  {
                    id: 'sales',
                    label: 'Sales',
                    expanded: true,
                    children: [
                      { id: 'orders', label: 'Orders', href: '/orders', active: true },
                      { id: 'reports', label: 'Reports', href: '/reports' },
                    ],
                  },
                ]}
              />,
              <TreeGrid
                label="Account hierarchy"
                rows={[
                  {
                    row: { id: '100', name: 'Assets', balance: '120.000.000 ₫' },
                    level: 1,
                    hasChildren: true,
                  },
                  { row: { id: '110', name: 'Cash', balance: '42.000.000 ₫' }, level: 2 },
                ]}
                id={(row) => row.id}
                primary={(row) => `${row.id} · ${row.name}`}
                columns={[{ key: 'balance', label: 'Balance', cell: (row) => row.balance }]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'inline-edit',
        name: 'Inline edit',
        description: 'Controlled edit state keeps a native form fallback, stale version and rejected input.',
        render: () => (
          <InlineEdit
            id="customer-name"
            label="Customer"
            value="An Việt"
            editing
            editHref="?edit=customer"
            cancelHref="?edit="
            action="/orders/SO-1042/customer"
            name="customer"
            inputValue="An Việt Trading"
            version="7"
          />
        ),
      },
    ],
  },
  {
    id: 'record-workspace',
    name: 'Record and workspace composition',
    description: 'Neutral record facts, activity and media compose inside the three canonical page patterns.',
    examples: [
      {
        id: 'record-display',
        name: 'Record facts and formatted values',
        description: 'Identity, status and locale-aware values remain small, reusable display primitives.',
        render: () => (
          <Stack
            items={[
              <Inline
                items={[
                  <Person name="Ngọc Linh" detail="Sales operations" />,
                  <AvatarGroup
                    label="Order collaborators"
                    people={[
                      { id: 'linh', name: 'Ngọc Linh' },
                      { id: 'minh', name: 'Minh Anh' },
                      { id: 'ha', name: 'Thu Hà' },
                      { id: 'nam', name: 'Hoàng Nam' },
                      { id: 'vy', name: 'Thảo Vy' },
                    ]}
                    max={4}
                  />,
                  <Status label="Ready" tone="positive" />,
                ]}
              />,
              <DescriptionList
                columns={3}
                items={[
                  { id: 'date', label: 'Delivery date', value: <FormattedDate value="2026-09-08" /> },
                  { id: 'quantity', label: 'Quantity', value: <FormattedNumber value={1200} /> },
                  {
                    id: 'total',
                    label: 'Total',
                    value: <FormattedMoney value={18450000} currency="VND" />,
                  },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'record-composition',
        name: 'Record summary, actions and rail',
        description: 'One identity header and one neutral aside prevent nested-card drift.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <Stack
                items={[
                  <RecordSummary
                    title="SO-1042"
                    subtitle="An Việt Trading"
                    person={{ name: 'Ngọc Linh', detail: 'Owner' }}
                    status={{ label: 'Ready', tone: 'positive' }}
                    facts={[
                      { id: 'date', label: 'Delivery', value: '08/09/2026' },
                      { id: 'total', label: 'Total', value: '18.450.000 ₫' },
                    ]}
                  />,
                  <RecordActions
                    actions={[
                      <Button label="Confirm" variant="primary" />,
                      <ActionMenu id="record-more" label="More" items={[]} />,
                    ]}
                  />,
                ]}
              />,
              <RecordRail
                sections={[
                  {
                    id: 'owner',
                    title: 'Owner',
                    body: <Person name="Ngọc Linh" detail="Sales operations" />,
                  },
                  { id: 'health', title: 'Health', body: <Status label="On track" tone="positive" /> },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'activity-audit',
        name: 'Activity timeline and audit log',
        description:
          'Applications own permission, redaction and queries; renderers expose all result states.',
        render: () => {
          const activity = [
            {
              id: 'a1',
              actor: 'Ngọc Linh',
              action: 'moved the order to Ready',
              datetime: '2026-09-08T14:30:00+07:00',
              timeLabel: '14:30 today',
            },
            {
              id: 'a2',
              actor: 'System',
              action: 'synchronized a protected value',
              datetime: '2026-09-08T14:25:00+07:00',
              timeLabel: '14:25 today',
              redacted: true,
            },
          ]
          return (
            <Grid
              columns={2}
              items={[
                <ActivityTimeline label="Activity" items={activity} />,
                <AuditLog label="Audit log" items={activity} />,
              ]}
            />
          )
        },
      },
      {
        id: 'attachments-media',
        name: 'Attachments and media',
        description:
          'Storage URLs and mutations stay in the application; public components render authorized results.',
        render: () => (
          <Grid
            columns={2}
            items={[
              <Attachments
                label="Order attachments"
                items={[
                  { id: 'invoice', name: 'invoice-SO-1042.pdf', href: '/files/invoice', meta: '238 KB' },
                  { id: 'contract', name: 'Restricted contract', redacted: true },
                ]}
              />,
              <MediaGallery
                label="Delivery media"
                items={[
                  { id: 'restricted', alt: '', redacted: true, caption: 'Permission required' },
                  {
                    id: 'proof',
                    alt: 'Delivery proof placeholder',
                    src: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22300%22%3E%3Crect width=%22400%22 height=%22300%22 fill=%22%23eef0fb%22/%3E%3Cpath d=%22M80 220l70-80 50 50 50-70 80 100%22 fill=%22none%22 stroke=%22%23566fd1%22 stroke-width=%2212%22/%3E%3C/svg%3E',
                    caption: 'Delivery proof',
                  },
                ]}
              />,
            ]}
          />
        ),
      },
      {
        id: 'canonical-recipes',
        name: 'Canonical page recipes',
        description:
          'Worklist, analytical list, settings and master-detail vary slots—not page-pattern count.',
        render: () => (
          <Grid
            columns={3}
            items={[
              <ContentCard title="ListPage" body="Worklist · analytical list · settings" />,
              <ContentCard title="RecordPage" body="Summary · facts · timeline · attachments" />,
              <ContentCard title="WorkspacePage" body="Master-detail · board · schedule · timeline canvas" />,
            ]}
          />
        ),
      },
      {
        id: 'canvas-recipes',
        name: 'Optional canvas recipes',
        description: 'Board, schedule and timeline keep spatial columns and local horizontal overflow.',
        render: () => (
          <div data-pattern="workspace" data-workspace-mode="canvas">
            <Grid
              columns={3}
              items={[
                <ContentCard title="Backlog" body="SO-1047 · SO-1048" />,
                <ContentCard title="In progress" body="SO-1042 · SO-1043" />,
                <ContentCard title="Done" body="SO-1039 · SO-1040" />,
              ]}
            />
          </div>
        ),
      },
    ],
  },
]
