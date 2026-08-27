import { FormScreenFrame } from './page-frame.tsx'
import { type BranchChoice, type Frame, type PolicyRow, propertyFeedback, propertyForm, type PropertyFormValues, Section, stack, type TemplateResult, type Translator } from './shared.tsx'

export const newPropertyScreen = (
  _: Translator,
  values: PropertyFormValues,
  policies: readonly PolicyRow[],
  branches: readonly BranchChoice[],
  locale: string,
  frame: Frame,
  errors: readonly string[] = [],
): TemplateResult => (
  <FormScreenFrame
    translator={_}
    title={_('hospitality_core.property.create.title')}
    frame={frame}
    body={stack([
      propertyFeedback(_, null, errors),
      <Section
        title={_('hospitality_core.property.create.title')}
        description={_('hospitality_core.property.create.hint')}
        body={propertyForm(
          _,
          values,
          policies,
          branches,
          locale,
          `/admin/hospitality/properties/new?lang=${encodeURIComponent(locale)}`,
          _('hospitality_core.property.action.create'),
          `/admin/hospitality/properties?lang=${encodeURIComponent(locale)}`,
        )}
      />,
    ])}
  />
)
