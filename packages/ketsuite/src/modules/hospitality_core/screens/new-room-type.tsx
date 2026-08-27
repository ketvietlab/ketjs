import { FormScreenFrame } from './page-frame.tsx'
import {
  type Frame,
  type PolicyRow,
  type PropertyRow,
  roomTypeFeedback,
  roomTypeForm,
  type RoomTypeFormValues,
  Section,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const newRoomTypeScreen = (
  _: Translator,
  values: RoomTypeFormValues,
  properties: PropertyRow[],
  policies: PolicyRow[],
  locale: string,
  frame: Frame,
  errors: readonly string[] = [],
): TemplateResult => (
  <FormScreenFrame
    translator={_}
    title={_('hospitality_core.roomType.create.title')}
    frame={frame}
    body={stack([
      roomTypeFeedback(_, null, errors),
      <Section
        title={_('hospitality_core.roomType.create.title')}
        description={_('hospitality_core.roomType.create.hint')}
        body={roomTypeForm(
          _,
          values,
          properties,
          policies,
          locale,
          `/admin/hospitality/room-types/new?lang=${encodeURIComponent(locale)}`,
          _('hospitality_core.roomType.action.create'),
          `/admin/hospitality/room-types?property=${encodeURIComponent(values.propertyId)}&lang=${encodeURIComponent(locale)}`,
          true,
        )}
      />,
    ])}
  />
)
