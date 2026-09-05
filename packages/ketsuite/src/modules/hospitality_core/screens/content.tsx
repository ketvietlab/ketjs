import {
  CardGrid,
  choices,
  type ContentCompleteness,
  contentFeedback,
  type ContentImageRow,
  emptyState,
  FormCluster,
  type Frame,
  WorkspaceScreen,
  MediaPanel,
  Metric,
  type PropertyRow,
  RecordForm,
  type RoomTypeRow,
  Section,
  setupAction,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const contentScreen = (
  _: Translator,
  properties: PropertyRow[],
  roomTypes: RoomTypeRow[],
  propertyId: string | undefined,
  target: string,
  images: ContentImageRow[],
  completeness: ContentCompleteness,
  locale: string,
  query: string,
  frame: Frame,
  status?: string | null,
): TemplateResult => {
  const property = properties.find((row) => row.id === propertyId)
  const roomTypeId = target.startsWith('room_type:') ? target.slice('room_type:'.length) : null
  const roomType = roomTypes.find((row) => row.id === roomTypeId)
  const selectedLabel = roomType?.name ?? property?.name ?? _('hospitality_core.content.target.none')
  const categoryOptions = ['exterior', 'lobby', 'room', 'bathroom', 'restaurant', 'pool', 'other'].map(
    (value) => ({ value, label: _(`hospitality_core.content.category.${value}`) }),
  )
  const targetOptions = property
    ? [
        { value: 'property', label: _('hospitality_core.content.target.property') },
        ...roomTypes.map((row) => ({
          value: `room_type:${row.id}`,
          label: `${_('hospitality_core.content.target.roomType')} · ${row.name}`,
        })),
      ]
    : []
  const suffix = query ? `?${query}` : ''

  return (
    <WorkspaceScreen
      translator={_}
      title={_('hospitality_core.screen.content.title')}
      frame={frame}
      body={stack([
        contentFeedback(_, status),
        properties.length ? (
          <Section
            title={_('hospitality_core.screen.content.selection')}
            description={_('hospitality_core.screen.content.selectionHint')}
            body={
              <RecordForm
                action="/admin/hospitality/content"
                method="get"
                layout="inline"
                fields={[
                  {
                    name: 'property',
                    label: _('hospitality_core.content.field.property'),
                    type: 'select',
                    value: propertyId,
                    options: choices(properties),
                    required: true,
                  },
                  {
                    name: 'target',
                    label: _('hospitality_core.content.field.target'),
                    type: 'select',
                    value: target,
                    options: targetOptions,
                    required: true,
                  },
                ]}
                hidden={{ lang: locale }}
                submit={_('hospitality_core.action.select')}
                submitVariant="secondary"
              />
            }
          />
        ) : (
          emptyState(
            _('hospitality_core.screen.content.noProperty'),
            _('hospitality_core.screen.content.noPropertyHint'),
            {
              actions: setupAction(
                _('hospitality_core.property.action.create'),
                '/admin/hospitality/properties/new',
              ),
            },
          )
        ),
        ...(property
          ? [
              <CardGrid
                items={[
                  {
                    id: 'target',
                    label: _('hospitality_core.content.metric.target'),
                    value: selectedLabel,
                    tone: 'neutral' as const,
                  },
                  {
                    id: 'images',
                    label: _('hospitality_core.content.metric.images'),
                    value: String(images.length),
                    // A room nobody can see a picture of is a room nobody books.
                    tone: images.length ? ('neutral' as const) : ('warning' as const),
                  },
                  {
                    id: 'complete',
                    label: _('hospitality_core.content.metric.completeness'),
                    value: `${completeness.percent}%`,
                    detail: _(`hospitality_core.content.metric.fields`, {
                      completed: completeness.completed,
                      total: completeness.total,
                    }),
                    // The one figure on this screen that is a score, so it says
                    // whether it is finished.
                    tone: completeness.percent >= 100 ? ('positive' as const) : ('warning' as const),
                  },
                ]}
                id={(item) => item.id}
                card={(item) => (
                  <Metric
                    label={item.label}
                    value={item.value}
                    detail={'detail' in item ? item.detail : null}
                    tone={item.tone}
                  />
                )}
              />,
              <Section
                title={_('hospitality_core.screen.content.library')}
                description={_('hospitality_core.screen.content.libraryHint')}
                body={
                  <MediaPanel
                    status="ready"
                    images={images.map((image, index) => ({
                      id: image.id,
                      src: `/files/${image.attachmentId}`,
                      alt: image.caption || image.attachment?.name || selectedLabel,
                      primary: image.primary,
                      actions: {
                        primary: `/admin/hospitality/content/images/${image.id}/primary${suffix}`,
                        remove: `/admin/hospitality/content/images/${image.id}/remove${suffix}`,
                        ...(index > 0
                          ? { moveUp: `/admin/hospitality/content/images/${image.id}/move-up${suffix}` }
                          : {}),
                        ...(index < images.length - 1
                          ? { moveDown: `/admin/hospitality/content/images/${image.id}/move-down${suffix}` }
                          : {}),
                      },
                    }))}
                    uploadAction={`/admin/hospitality/content/upload${suffix}`}
                    labels={{
                      empty: _('hospitality_core.content.media.empty'),
                      primary: _('hospitality_core.content.media.primary'),
                      makePrimary: _('hospitality_core.content.media.makePrimary'),
                      moveUp: _('hospitality_core.content.media.moveUp'),
                      moveDown: _('hospitality_core.content.media.moveDown'),
                      remove: _('hospitality_core.content.media.remove'),
                      choose: _('hospitality_core.content.media.choose'),
                      add: _('hospitality_core.content.media.add'),
                    }}
                    extension={
                      images.length ? (
                        <FormCluster
                          label={_('hospitality_core.content.metadata.group')}
                          forms={images.map((image) => (
                            <RecordForm
                              action={`/admin/hospitality/content/images/${image.id}/metadata${suffix}`}
                              layout="inline"
                              fields={[
                                {
                                  name: 'category',
                                  label: _('hospitality_core.content.field.category'),
                                  type: 'select',
                                  value: image.category,
                                  options: categoryOptions,
                                  required: true,
                                },
                                {
                                  name: 'caption',
                                  label: _('hospitality_core.content.field.caption'),
                                  value: image.caption,
                                  placeholder: image.attachment?.name ?? null,
                                },
                              ]}
                              hidden={{ id: image.id }}
                              submit={_('hospitality_core.content.action.saveMetadata')}
                              submitVariant="secondary"
                              submitSize="compact"
                            />
                          ))}
                        />
                      ) : undefined
                    }
                  />
                }
              />,
            ]
          : []),
      ])}
    />
  )
}
