import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  framedPage as Framed,
  icon,
  recordForm as RecordForm,
  recordWorkspace as RecordWorkspace,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
import type { Column, FormOption, Frame } from '../../ui/index.ts'

export type StockRouteRuleRow = {
  id: string
  name: string
  action: string
  actionLabel: string
  sequence: number
  source: string
  destination: string
  operationType: string
  procureMethod: string
}

export type StockRouteDetailOptions = {
  route: { id: string; name: string; sequence: number; active: boolean }
  rows: StockRouteRuleRow[]
  locations: FormOption[]
  pickingTypes: FormOption[]
  action: string
  routeErrors?: string[]
  ruleErrors?: string[]
}

const ruleColumns = (_: Translator): Array<Column<StockRouteRuleRow>> => [
  {
    key: 'name',
    label: _('stock_backend.stockRoute.rule.col.name'),
    cell: (row) => row.name,
    priority: 'primary',
  },
  {
    key: 'action',
    label: _('stock_backend.field.ruleAction'),
    cell: (row) => badge(row.actionLabel, row.action === 'push' ? 'info' : 'neutral'),
    priority: 'secondary',
  },
  {
    key: 'source',
    label: _('stock_backend.field.sourceLocation'),
    cell: (row) => row.source,
  },
  {
    key: 'destination',
    label: _('stock_backend.field.destinationLocation'),
    cell: (row) => row.destination,
  },
  {
    key: 'operationType',
    label: _('stock_backend.field.operationType'),
    cell: (row) => row.operationType,
  },
  {
    key: 'procureMethod',
    label: _('stock_backend.field.procureMethod'),
    cell: (row) => row.procureMethod,
  },
  {
    key: 'sequence',
    label: _('stock_backend.field.sequence'),
    cell: (row) => String(row.sequence),
    kind: 'number',
  },
]

const routeForm = (_: Translator, options: StockRouteDetailOptions): TemplateResult => (
  <RecordForm
    id="stock-route-detail-form"
    scope="stock-route"
    action={options.action}
    hidden={{ intent: 'route' }}
    submit={_('stock_backend.action.save')}
    submitVariant="primary"
    errors={options.routeErrors}
    fields={[
      {
        name: 'name',
        label: _('stock_backend.stockRoute.field.name'),
        value: options.route.name,
        required: true,
      },
      {
        name: 'sequence',
        label: _('stock_backend.field.sequence'),
        type: 'number',
        value: options.route.sequence,
        help: _('stock_backend.stockRoute.field.sequence.help'),
      },
    ]}
  />
)

const ruleForm = (_: Translator, options: StockRouteDetailOptions): TemplateResult => (
  <RecordForm
    id="stock-route-rule-form"
    scope="stock-route-rule"
    action={options.action}
    hidden={{ intent: 'rule' }}
    submit={_('stock_backend.action.addRule')}
    submitVariant="secondary"
    errors={options.ruleErrors}
    fields={[
      {
        name: 'name',
        label: _('stock_backend.col.name'),
        placeholder: _('stock_backend.stockRoute.rule.name.placeholder'),
        required: true,
      },
      {
        name: 'action',
        label: _('stock_backend.field.ruleAction'),
        type: 'select',
        options: [
          { value: 'pull', label: _('stock_backend.ruleAction.pull') },
          { value: 'push', label: _('stock_backend.ruleAction.push') },
          { value: 'pull_push', label: _('stock_backend.ruleAction.pull_push') },
        ],
      },
      { name: 'sequence', label: _('stock_backend.field.sequence'), type: 'number', value: 20 },
      {
        name: 'locationSrcId',
        label: _('stock_backend.field.sourceLocation'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.locations],
      },
      {
        name: 'locationDestId',
        label: _('stock_backend.field.destinationLocation'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.locations],
        required: true,
      },
      {
        name: 'pickingTypeId',
        label: _('stock_backend.field.operationType'),
        type: 'select',
        options: [{ value: '', label: '—' }, ...options.pickingTypes],
        required: true,
      },
      {
        name: 'procureMethod',
        label: _('stock_backend.field.procureMethod'),
        type: 'select',
        options: [
          { value: 'make_to_stock', label: _('stock_backend.procureMethod.make_to_stock') },
          { value: 'make_to_order', label: _('stock_backend.procureMethod.make_to_order') },
          { value: 'mts_else_mto', label: _('stock_backend.procureMethod.mts_else_mto') },
        ],
      },
    ]}
  />
)

export const stockRouteDetailScreen = (
  _: Translator,
  options: StockRouteDetailOptions,
  frame: Frame,
): TemplateResult => {
  const pullCount = options.rows.filter((row) => row.action === 'pull' || row.action === 'pull_push').length
  const pushCount = options.rows.filter((row) => row.action === 'push' || row.action === 'pull_push').length
  const rules = options.rows.length ? (
    dataTable(_, { columns: ruleColumns(_), rows: options.rows, id: (row) => row.id })
  ) : (
    <Surface
      padding="compact"
      body={emptyState(
        _('stock_backend.stockRoute.rule.empty'),
        _('stock_backend.stockRoute.rule.emptyHint'),
        { icon: icon('sliders-horizontal') },
      )}
    />
  )

  return (
    <Framed
      translator={_}
      title={_('stock_backend.routeDetail')}
      frame={frame}
      body={
        <RecordWorkspace
          kicker={_('stock_backend.stockRoute.detail.kicker')}
          title={options.route.name}
          subtitle={`${_('stock_backend.field.sequence')}: ${options.route.sequence}`}
          imageFallback={icon('sliders-horizontal')}
          badges={[
            badge(
              options.route.active
                ? _('stock_backend.stockRoute.status.active')
                : _('stock_backend.stockRoute.status.archived'),
              options.route.active ? 'positive' : 'danger',
            ),
          ]}
          summary={[
            {
              id: 'rules',
              label: _('stock_backend.stockRoute.detail.summary.rules'),
              value: options.rows.length,
            },
            { id: 'pull', label: _('stock_backend.stockRoute.detail.summary.pull'), value: pullCount },
            { id: 'push', label: _('stock_backend.stockRoute.detail.summary.push'), value: pushCount },
          ]}
          body={stack(
            [
              <Section
                title={_('stock_backend.stockRoute.detail.information.title')}
                description={_('stock_backend.stockRoute.detail.information.hint')}
                body={<Surface padding="compact" body={routeForm(_, options)} />}
              />,
              <Section
                title={_('stock_backend.stockRoute.detail.rules.title')}
                description={_('stock_backend.stockRoute.detail.rules.hint')}
                body={rules}
              />,
              <Section
                title={_('stock_backend.stockRoute.rule.create.title')}
                description={_('stock_backend.stockRoute.rule.create.hint')}
                body={<Surface padding="compact" body={ruleForm(_, options)} />}
              />,
            ],
            'loose',
          )}
        />
      }
    />
  )
}
