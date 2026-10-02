import { Surface, Stack, TextField, Checkbox, Notice, LinkButton } from '@ketvietlab/design-system'
import { CommandButton, fragments } from '../ui.tsx'
import { publicFrame } from './visitor-commerce.tsx'
import { newId } from './format.ts'
import type { CommandArgs, Screen, StudioContext } from '../types.ts'

/** The signed-in visitor, as the site's own account store keeps them. */
type VisitorAccount = { name: string; email: string; phone?: string; verified: boolean; revision?: string }
/** What the last account command did; a recovery keeps its request open until it expires. */
type AccountResult = { state: string; requestId?: string; expiresAt?: string }

export function safeVisitorReturn(value: unknown, siteId: string) {
  if (typeof value !== 'string' || !value.startsWith('/website/visit/') || /[\\\s]/.test(value)) return null
  try {
    const url = new URL(value, 'https://website.invalid')
    if (
      url.origin !== 'https://website.invalid' ||
      !url.pathname.startsWith('/website/visit/') ||
      decodeURIComponent(url.pathname).includes('..') ||
      (url.searchParams.has('site') && url.searchParams.get('site') !== siteId)
    )
      return null
    url.searchParams.set('site', siteId)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}
export function createVisitorAccount(ctx: StudioContext, mode = 'profile') {
  let result: AccountResult | null = null,
    account: VisitorAccount | null = null
  const t = (key: string) => ctx.tr(`website.account.${key}`)
  const field = (name: string, value = '', type: 'text' | 'email' | 'tel' | 'password' = 'text') => (
    <TextField id={`account-${name}`} name={name} label={t(name)} value={value} type={type} />
  )
  const button = (action: string, form = 'visitor-account') => (
    <CommandButton
      label={t(action)}
      command={`account.${mode}.${action}`}
      type="submit"
      form={form}
      disabled={ctx.busy()}
    />
  )
  return {
    read: async (_route, signal) => {
      const data = await ctx.call<{ account: VisitorAccount | null }>(
        'website_studio.visitorAccount',
        { siteId: ctx.site().id },
        { signal },
      )
      account = data.account
      return data
    },
    view: (data, route) => {
      const returnTo = safeVisitorReturn(route?.query?.returnTo, ctx.site().id)
      return publicFrame(
        ctx,
        t(mode === 'profile' ? 'profileTitle' : mode),
        <Stack
          items={[
            <Notice title={t('simulation')} message={t('simulationHelp')} tone="info" />,
            result ? (
              <Notice
                title={t('result')}
                message={ctx.tr(`website.account.result.${result.state}`)}
                tone="positive"
              />
            ) : null,
            data.account && mode !== 'recovery' ? (
              <Surface
                title={data.account.name}
                body={
                  <>
                    <p>{data.account.email}</p>
                    <form id="visitor-account-current" novalidate>
                      {data.account.verified ? (
                        <>
                          {field('name', data.account.name)}
                          {field('phone', data.account.phone, 'tel')}
                          {button('profile', 'visitor-account-current')}
                          {field('confirm')}
                          {button('erase', 'visitor-account-current')}
                        </>
                      ) : (
                        <>
                          {field('code')}
                          {button('verify', 'visitor-account-current')}
                        </>
                      )}
                      {button('logout', 'visitor-account-current')}
                    </form>
                    {data.account.verified
                      ? fragments([
                          <LinkButton label={t('orders')} href={ctx.href('own-orders')} />,
                          <LinkButton label={t('bookings')} href={ctx.href('own-bookings')} />,
                          returnTo ? <LinkButton label={t('continue')} href={returnTo} /> : null,
                        ])
                      : null}
                  </>
                }
              />
            ) : (
              <Surface
                title={t(mode === 'profile' ? 'login' : mode)}
                body={
                  <>
                    <form id="visitor-account" novalidate>
                      <Stack
                        items={[
                          mode === 'register' ? field('name') : null,
                          field('email', '', 'email'),
                          mode === 'register' ? (
                            <Checkbox id="account-consent" name="consent" label={t('consent')} />
                          ) : null,
                          mode === 'login' || mode === 'profile' ? field('code') : null,
                          button(mode === 'register' ? 'register' : mode === 'recovery' ? 'reset' : 'login'),
                        ]}
                      />
                    </form>
                    {mode === 'recovery' && result?.requestId ? (
                      <form id="visitor-recovery" novalidate>
                        <p>
                          {t('expires')}: {result.expiresAt}
                        </p>
                        {field('code')}
                        {field('password', '', 'password')}
                        <p>{t('passwordHelp')}</p>
                        {button('recover', 'visitor-recovery')}
                      </form>
                    ) : null}
                  </>
                }
              />
            ),
            fragments(
              [
                ['visitor-register', 'register'],
                ['visitor-login', 'login'],
                ['visitor-recovery', 'reset'],
              ].map(([key, label]) => <LinkButton label={t(label)} href={ctx.href(key, {}, { returnTo })} />),
            ),
          ]}
        />,
      )
    },
    commands: Object.fromEntries(
      ['register', 'login', 'reset', 'recover', 'verify', 'logout', 'erase', 'profile'].map((action) => [
        `account.${mode}.${action}`,
        async (_args: CommandArgs, form?: FormData) => {
          result = await ctx.call<AccountResult>('website_studio.visitorAccountCommand', {
            siteId: ctx.site().id,
            id: newId('visitor'),
            action,
            expectedRevision: account?.revision,
            requestId: result?.requestId,
            ...Object.fromEntries(
              ['name', 'phone', 'email', 'code', 'password', 'confirm'].map((key) => [
                key,
                String(form?.get(key) ?? ''),
              ]),
            ),
            consent: form?.has('consent') === true,
          })
          await ctx.refresh()
        },
      ]),
    ),
  } satisfies Screen<{ account: VisitorAccount | null }>
}
