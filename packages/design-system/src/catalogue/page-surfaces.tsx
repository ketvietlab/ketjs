import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { AppShell } from '../layouts/shell.tsx'
import { Grid, Inline, Metric, Section, Stack, Surface } from '../layouts/index.tsx'
import { ActionGroup, Button, LinkButton } from '../primitives/actions.tsx'
import { Field } from '../primitives/field.tsx'
import { EmptyState, LoadingState, Notice } from '../primitives/feedback.tsx'
import { NavList, Tabs } from '../primitives/navigation.tsx'
import { ListPage } from '../patterns/list-page.tsx'
import { RecordPage } from '../patterns/record-page.tsx'
import { WorkspacePage } from '../patterns/workspace-page.tsx'
import { FormPage } from '../patterns/form-page.tsx'
import { DashboardPage } from '../patterns/dashboard-page.tsx'
import { BoardPage } from '../patterns/board-page.tsx'
import { DataTable } from '../patterns/data-table.tsx'

export const surfaceKinds = [
  'list',
  'record',
  'flow',
  'canvas',
  'form-compat',
  'dashboard-compat',
  'board-compat',
] as const
export const surfaceStates = ['baseline', 'loading', 'empty', 'error', 'validation', 'readonly'] as const

export type PageSurfaceProps = {
  kind: (typeof surfaceKinds)[number]
  state: (typeof surfaceStates)[number]
  lang: 'en' | 'vi'
  theme: 'light' | 'dark'
  tab: 'details' | 'activity'
  aside: boolean
  controls: boolean
}

/** Full-page catalogue specimens; never imported by the production entry point. */
export const PageSurfacePreview = (props: PageSurfaceProps): TemplateResult => {
  const vi = props.lang === 'vi'
  const labels = vi
    ? {
        title: 'Hồ sơ và công việc',
        description: 'Kiểm tra thông tin và xử lý công việc trong ngày.',
        context: 'Cơ sở minh họa',
        save: 'Lưu thay đổi',
        back: 'Quay lại',
        details: 'Thông tin',
        activity: 'Hoạt động',
        name: 'Tên hiển thị',
        note: 'Ghi chú',
        search: 'Tìm kiếm',
        refresh: 'Làm mới',
        section: 'Thông tin chính',
        auxiliary: 'Thông tin liên quan',
        hint: 'Chỉ dùng dữ liệu minh họa.',
        loading: 'Đang tải dữ liệu',
        empty: 'Chưa có dữ liệu',
        error: 'Chưa tải được thông tin',
        readonly: 'Bạn đang ở chế độ chỉ xem',
        validation: 'Vui lòng bổ sung tên.',
        column: 'Hồ sơ',
        status: 'Trạng thái',
        ready: 'Sẵn sàng',
        pending: 'Cần kiểm tra',
      }
    : {
        title: 'Records and daily work',
        description: 'Review information and advance the work for today.',
        context: 'Example organisation',
        save: 'Save changes',
        back: 'Back',
        details: 'Details',
        activity: 'Activity',
        name: 'Display name',
        note: 'Notes',
        search: 'Search',
        refresh: 'Refresh',
        section: 'Main information',
        auxiliary: 'Related information',
        hint: 'Synthetic catalogue data only.',
        loading: 'Loading records',
        empty: 'No records yet',
        error: 'Unable to load records',
        readonly: 'You have read-only access',
        validation: 'Enter a display name.',
        column: 'Record',
        status: 'Status',
        ready: 'Ready',
        pending: 'Needs review',
      }
  const href = (overrides: Record<string, string> = {}) =>
    '/surfaces?' +
    new URLSearchParams({
      ...Object.fromEntries(Object.entries(props).map(([key, value]) => [key, String(value)])),
      ...overrides,
    })
  const record = props.kind === 'record' || props.kind === 'form-compat'
  const canvas = props.kind === 'canvas' || props.kind === 'board-compat'
  const blocked = ['loading', 'empty', 'error', 'readonly'].includes(props.state)
  const table = (
    <DataTable
      responsive={canvas ? 'scroll' : 'stack'}
      rows={[
        { id: 'REC-001', status: labels.ready },
        { id: 'REC-002', status: labels.pending },
      ]}
      id={(row) => row.id}
      columns={[
        { key: 'id', label: labels.column, cell: (row) => row.id },
        { key: 'status', label: labels.status, cell: (row) => row.status },
      ]}
    />
  )
  const form = (
    <form data-ui="record-form" id="specimen-form">
      <Surface
        body={
          <Section
            title={props.tab === 'details' ? labels.section : labels.activity}
            body={
              <Stack
                items={[
                  <Field
                    id="display-name"
                    name="name"
                    label={labels.name}
                    value="Example record"
                    disabled={blocked}
                    error={props.state === 'validation' ? labels.validation : undefined}
                  />,
                  <Field
                    id="notes"
                    name="notes"
                    label={labels.note}
                    type="textarea"
                    value={labels.hint}
                    disabled={blocked}
                  />,
                ]}
              />
            }
          />
        }
      />
    </form>
  )
  let body: JSXChild = record ? (
    form
  ) : props.kind === 'list' ? (
    table
  ) : (
    <Stack
      items={[
        <Grid
          columns={3}
          items={[
            <Metric label={labels.ready} value="24" />,
            <Metric label={labels.pending} value="3" tone="warning" />,
            <Metric label={labels.activity} value="12" />,
          ]}
        />,
        <Surface body={<Section title={labels.details} body={table} />} />,
      ]}
    />
  )
  if (props.state === 'loading') body = <Surface body={<LoadingState label={labels.loading} />} />
  if (props.state === 'empty')
    body = <Surface body={<EmptyState title={labels.empty} message={labels.hint} />} />
  if (props.state === 'error') body = <Notice title={labels.error} message={labels.hint} tone="danger" />
  if (props.state === 'readonly')
    body = <Stack items={[<Notice title={labels.readonly} message={labels.hint} />, body]} />
  const actions = (
    <ActionGroup
      actions={[
        <LinkButton label={labels.back} href="/?theme=light" variant="secondary" />,
        <Button label={labels.save} variant="primary" disabled={blocked} />,
      ]}
    />
  )
  const controls = props.controls ? (
    <Inline
      items={[
        <LinkButton label={labels.search} href={href({ state: 'empty' })} variant="secondary" />,
        <LinkButton label={labels.refresh} href={href({ state: 'baseline' })} variant="secondary" />,
      ]}
    />
  ) : undefined
  const common = {
    title: labels.title,
    description: labels.description,
    context: labels.context,
    variant: 'operational' as const,
    actions,
    body,
  }
  const navigation = (
    <Tabs
      label={labels.section}
      items={[
        {
          id: 'details',
          label: labels.details,
          href: href({ tab: 'details' }),
          active: props.tab === 'details',
        },
        {
          id: 'activity',
          label: labels.activity,
          href: href({ tab: 'activity' }),
          active: props.tab === 'activity',
        },
      ]}
    />
  )
  const recordProps = {
    ...common,
    navigation,
    controller: '',
    ...(props.aside
      ? {
          aside: <Surface body={<Section title={labels.auxiliary} body={labels.hint} />} />,
          asideLabel: labels.auxiliary,
        }
      : {}),
  }
  const main =
    props.kind === 'list' ? (
      <ListPage {...common} controls={controls} footer={labels.hint} />
    ) : props.kind === 'record' ? (
      <RecordPage {...recordProps} />
    ) : props.kind === 'form-compat' ? (
      <FormPage {...recordProps} />
    ) : props.kind === 'dashboard-compat' ? (
      <DashboardPage {...common} />
    ) : props.kind === 'board-compat' ? (
      <BoardPage {...common} controls={controls} />
    ) : (
      <WorkspacePage {...common} layout={canvas ? 'canvas' : 'flow'} controls={controls} />
    )
  return (
    <div data-kv-design-system data-ui="catalogue-surface-preview" data-theme={props.theme}>
      <AppShell
        mode="viewport"
        sidebar={
          <NavList
            label="Page patterns"
            items={surfaceKinds.map((kind) => ({
              label: kind,
              href: href({ kind }),
              active: kind === props.kind,
            }))}
          />
        }
        main={main}
      />
    </div>
  )
}
