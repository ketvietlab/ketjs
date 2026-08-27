import { CardGrid, type Choice, choices, dataTable, DatePicker, emptyState, formatMoney, FormCluster, type Frame, Framed, Metric, nightAuditColumns, nightAuditFeedback, type NightAuditPreview, type NightAuditRow, RecordForm, Section, stack, type TemplateResult, type Translator } from './shared.tsx'

export const nightAuditScreen = (
  _: Translator,
  data: {
    properties: Choice[]
    propertyId?: string
    auditDate: string
    today: string
    preview?: NightAuditPreview
    runs: NightAuditRow[]
  },
  locale: string,
  frame: Frame,
  state?: string | null,
): TemplateResult => {
  if (!data.propertyId)
    return (
      <Framed
        translator={_}
        title={_('hospitality_core.screen.nightAudit.title')}
        frame={frame}
        body={emptyState(
          _('hospitality_core.nightAudit.empty.property'),
          _('hospitality_core.nightAudit.empty.propertyHint'),
        )}
      />
    )
  const lang: Record<string, string> = { lang: locale }
  return (
    <Framed
      translator={_}
      title={_('hospitality_core.screen.nightAudit.title')}
      frame={frame}
      body={stack([
        nightAuditFeedback(_, state),
        <FormCluster
          label={_('hospitality_core.nightAudit.section.selection')}
          forms={[
            <RecordForm
              action="/admin/hospitality/night-audit"
              method="get"
              layout="inline"
              submit={_('hospitality_core.action.select')}
              submitVariant="secondary"
              hidden={{ ...lang, auditDate: data.auditDate }}
              fields={[
                {
                  name: 'property',
                  label: _('hospitality_core.menu.properties'),
                  type: 'select',
                  value: data.propertyId,
                  options: choices(data.properties),
                  required: true,
                },
              ]}
            />,
            <DatePicker
              action="/admin/hospitality/night-audit"
              label={_('hospitality_core.nightAudit.field.auditDate')}
              fields={[
                {
                  name: 'auditDate',
                  label: _('hospitality_core.nightAudit.field.auditDate'),
                  value: data.auditDate,
                  max: data.today,
                  required: true,
                },
              ]}
              hidden={{ ...lang, property: data.propertyId }}
              submit={_('hospitality_core.nightAudit.action.preview')}
            />,
          ]}
        />,
        data.preview ? (
          <CardGrid
            items={[
              {
                id: 'in-house',
                label: _('hospitality_core.nightAudit.metric.inHouse'),
                value: data.preview.inHouseCount,
              },
              {
                id: 'services',
                label: _('hospitality_core.nightAudit.metric.servicesDue'),
                value: data.preview.serviceDue,
              },
              {
                id: 'rent',
                label: _('hospitality_core.nightAudit.metric.rentDue'),
                value: data.preview.rentDue,
              },
              {
                id: 'night-audit-amount',
                label: _('hospitality_core.nightAudit.metric.estimated'),
                value: formatMoney(_, data.preview.estimatedAmount),
              },
            ]}
            id={(item) => item.id}
            card={(item) => <Metric label={item.label} value={String(item.value)} tone={item.id} />}
          />
        ) : null,
        <Section
          title={_('hospitality_core.nightAudit.section.run')}
          description={_('hospitality_core.nightAudit.section.runHint')}
          body={
            <RecordForm
              action="/admin/hospitality/night-audit"
              method="post"
              submit={_('hospitality_core.nightAudit.action.run')}
              submitVariant="primary"
              hidden={{
                ...lang,
                operation: 'request-night-audit',
                propertyId: data.propertyId,
                auditDate: data.auditDate,
              }}
              fields={[]}
            />
          }
        />,
        <Section
          title={_('hospitality_core.nightAudit.section.history')}
          description={_('hospitality_core.nightAudit.section.historyHint')}
          body={
            data.runs.length
              ? dataTable(_, { columns: nightAuditColumns(_, locale), rows: data.runs, id: (row) => row.id })
              : emptyState(
                  _('hospitality_core.nightAudit.empty.runs'),
                  _('hospitality_core.nightAudit.empty.runsHint'),
                )
          }
        />,
      ])}
    />
  )
}
