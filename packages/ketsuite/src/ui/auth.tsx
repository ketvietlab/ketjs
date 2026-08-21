import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { linkButton } from './actions.tsx'
import { recordForm } from './form.tsx'
import { notice } from './state.tsx'
import { stack, surface } from './surfaces.tsx'

export const authTokenScreen = (
  _: Translator,
  options: { kind: 'invitation' | 'reset'; token: string; errors?: string[]; complete?: boolean },
): TemplateResult =>
  options.complete
    ? stack([
        notice({
          tone: 'positive',
          title: _('user.token.completeTitle'),
          message: _('user.token.completeHint'),
          actions: linkButton({ label: _('user.token.signIn'), href: '/login', variant: 'primary' }),
        }),
      ])
    : stack([
        notice({
          tone: 'info',
          title: _(`user.token.${options.kind}Title`),
          message: _(`user.token.${options.kind}Hint`),
        }),
        surface({
          body: recordForm({
            action: `/auth/${options.kind}`,
            submit: _('user.token.submit'),
            submitVariant: 'primary',
            errors: options.errors,
            hidden: { token: options.token },
            fields: [
              {
                name: 'password',
                label: _('user.token.password'),
                type: 'password',
                required: true,
              },
              {
                name: 'confirmPassword',
                label: _('user.token.confirmPassword'),
                type: 'password',
                required: true,
              },
            ],
          }),
        }),
      ])
