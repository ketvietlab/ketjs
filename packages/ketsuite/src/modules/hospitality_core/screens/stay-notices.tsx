import {
  CardGrid,
  type Choice,
  choices,
  dataTable,
  DefinitionList,
  emptyState,
  type Frame,
  WorkspaceScreen,
  Metric,
  Notice,
  RecordForm,
  Section,
  stack,
  stayNoticeAction,
  stayNoticeColumns,
  stayNoticeDocument,
  stayNoticeFeedback,
  stayNoticeHref,
  stayNoticeIssues,
  type StayNoticeRow,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const stayNoticesScreen = (
  _: Translator,
  data: {
    properties: Choice[]
    propertyId?: string
    state: string
    rows: StayNoticeRow[]
    selected?: StayNoticeRow
  },
  locale: string,
  timezone: string,
  frame: Frame,
  feedbackState?: string | null,
): TemplateResult => {
  if (!data.propertyId)
    return (
      <WorkspaceScreen
        translator={_}
        title={_('hospitality_core.screen.stayNotices.title')}
        frame={frame}
        body={emptyState(
          _('hospitality_core.stayNotice.empty.property'),
          _('hospitality_core.stayNotice.empty.propertyHint'),
        )}
      />
    )
  const counts = Object.fromEntries(
    ['attention', 'ready', 'submitted', 'confirmed'].map((state) => [
      state,
      data.rows.filter((row) => row.state === state).length,
    ]),
  )
  const visibleRows = data.state === 'all' ? data.rows : data.rows.filter((row) => row.state === data.state)
  const action = data.selected
    ? stayNoticeAction(_, data.selected, locale, data.propertyId, data.state)
    : null
  return (
    <WorkspaceScreen
      translator={_}
      title={_('hospitality_core.screen.stayNotices.title')}
      frame={frame}
      body={stack([
        stayNoticeFeedback(_, feedbackState),
        <Notice
          tone="info"
          title={_('hospitality_core.stayNotice.privacy.title')}
          message={_('hospitality_core.stayNotice.privacy.hint')}
        />,
        <RecordForm
          action="/admin/hospitality/stay-notices"
          method="get"
          layout="inline"
          submit={_('hospitality_core.action.select')}
          submitVariant="secondary"
          hidden={{ lang: locale }}
          fields={[
            {
              name: 'property',
              label: _('hospitality_core.menu.properties'),
              type: 'select',
              value: data.propertyId,
              options: choices(data.properties),
              required: true,
            },
            {
              name: 'state',
              label: _('hospitality_core.col.status'),
              type: 'select',
              value: data.state,
              options: ['all', 'attention', 'ready', 'submitted', 'confirmed'].map((value) => ({
                value,
                label: _(`hospitality_core.stayNotice.state.${value}`),
              })),
            },
          ]}
        />,
        <CardGrid
          items={['attention', 'ready', 'submitted', 'confirmed'].map((state) => ({
            state,
            count: Number(counts[state] ?? 0),
          }))}
          id={(item) => item.state}
          card={(item) => (
            <Metric
              label={_(`hospitality_core.stayNotice.state.${item.state}`)}
              value={String(item.count)}
              tone={item.state}
            />
          )}
        />,
        ...(data.selected
          ? [
              <Section
                title={_('hospitality_core.stayNotice.section.selected')}
                description={_('hospitality_core.stayNotice.section.selectedHint')}
                body={stack([
                  <DefinitionList
                    title={data.selected.guestName}
                    items={[
                      {
                        key: 'state',
                        term: _('hospitality_core.col.status'),
                        value: _(`hospitality_core.stayNotice.state.${data.selected.state}`),
                      },
                      {
                        key: 'document',
                        term: _('hospitality_core.stayNotice.col.document'),
                        value: stayNoticeDocument(_, data.selected),
                      },
                      {
                        key: 'reason',
                        term: _('hospitality_core.stayNotice.field.reason'),
                        value: data.selected.reason
                          ? _(`hospitality_core.stayNotice.reason.${data.selected.reason}`)
                          : _('hospitality_core.stayNotice.value.missing'),
                      },
                      {
                        key: 'readiness',
                        term: _('hospitality_core.stayNotice.col.readiness'),
                        value: stayNoticeIssues(_, data.selected),
                      },
                      {
                        key: 'evidence',
                        term: _('hospitality_core.stayNotice.field.evidenceRef'),
                        value: data.selected.receiptRef || _('hospitality_core.stayNotice.value.missing'),
                      },
                    ]}
                  />,
                  action,
                ])}
              />,
            ]
          : []),
        <Section
          title={_('hospitality_core.stayNotice.section.queue')}
          description={_('hospitality_core.stayNotice.section.queueHint')}
          body={
            visibleRows.length
              ? dataTable(_, {
                  columns: stayNoticeColumns(_, locale, timezone),
                  rows: visibleRows,
                  id: (row) => row.id,
                  rowHref: (row) => stayNoticeHref(locale, data.propertyId!, data.state, row.id),
                })
              : emptyState(
                  _('hospitality_core.stayNotice.empty.rows'),
                  _('hospitality_core.stayNotice.empty.rowsHint'),
                )
          }
        />,
      ])}
    />
  )
}
