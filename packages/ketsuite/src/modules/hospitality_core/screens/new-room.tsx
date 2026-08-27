import { FormScreenFrame } from './page-frame.tsx'
import { type BuildingRow, type FloorRow, type Frame, type PropertyRow, roomFeedback, roomForm, type RoomFormValues, type RoomTypeRow, Section, stack, type TemplateResult, type Translator } from './shared.tsx'

export const newRoomScreen = (
  _: Translator,
  values: RoomFormValues,
  properties: PropertyRow[],
  roomTypes: RoomTypeRow[],
  buildings: BuildingRow[],
  floors: FloorRow[],
  locale: string,
  frame: Frame,
  errors: readonly string[] = [],
): TemplateResult => (
  <FormScreenFrame
    translator={_}
    title={_('hospitality_core.room.create.title')}
    frame={frame}
    body={stack([
      roomFeedback(_, null, errors),
      <Section
        title={_('hospitality_core.room.create.title')}
        description={_('hospitality_core.room.create.hint')}
        body={roomForm(
          _,
          values,
          properties,
          roomTypes,
          buildings,
          floors,
          locale,
          `/admin/hospitality/rooms/new?lang=${encodeURIComponent(locale)}`,
          _('hospitality_core.room.action.create'),
          `/admin/hospitality/rooms?property=${encodeURIComponent(values.propertyId)}&lang=${encodeURIComponent(locale)}`,
        )}
      />,
    ])}
  />
)
