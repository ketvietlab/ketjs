import { html } from '@ketvietlab/ketjs-view'
import { Surface, Stack, TextField, Checkbox, Notice, LinkButton } from '@ketvietlab/design-system'
import { h, CommandButton, fragments } from '../ui.mjs'
import { publicFrame } from './visitor-commerce.mjs'
import { newId } from './format.mjs'

export function safeVisitorReturn(value, siteId) {
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
export function createVisitorAccount(ctx, mode = 'profile') {
  let result = null,
    account = null
  const t = (key) => ctx.tr(`website.account.${key}`)
  const field = (name, value = '', type = 'text') =>
    h(TextField, { id: `account-${name}`, name, label: t(name), value, type })
  const button = (action, form = 'visitor-account') =>
    CommandButton({
      label: t(action),
      command: `account.${mode}.${action}`,
      type: 'submit',
      form,
      disabled: ctx.busy(),
    })
  return {
    read: async (_route, signal) => {
      const data = await ctx.call('website_studio.visitorAccount', { siteId: ctx.site().id }, { signal })
      account = data.account
      return data
    },
    view: (data, route) =>
      publicFrame(
        ctx,
        t(mode === 'profile' ? 'profileTitle' : mode),
        h(Stack, {
          items: [
            h(Notice, { title: t('simulation'), message: t('simulationHelp'), tone: 'info' }),
            result
              ? h(Notice, {
                  title: t('result'),
                  message: ctx.tr(`website.account.result.${result.state}`),
                  tone: 'positive',
                })
              : null,
            data.account && mode !== 'recovery'
              ? h(Surface, {
                  title: data.account.name,
                  body: html`<p>${data.account.email}</p><form id="visitor-account-current" novalidate>${
                    data.account.verified
                      ? html`${field('name', data.account.name)}${field('phone', data.account.phone, 'tel')}${button('profile', 'visitor-account-current')}${field('confirm')}${button('erase', 'visitor-account-current')}`
                      : html`${field('code')}${button('verify', 'visitor-account-current')}`
                  }${button('logout', 'visitor-account-current')}</form>${
                    data.account.verified
                      ? fragments([
                          h(LinkButton, { label: t('orders'), href: ctx.href('own-orders') }),
                          h(LinkButton, { label: t('bookings'), href: ctx.href('own-bookings') }),
                          safeVisitorReturn(route?.query?.returnTo, ctx.site().id)
                            ? h(LinkButton, {
                                label: t('continue'),
                                href: safeVisitorReturn(route.query.returnTo, ctx.site().id),
                              })
                            : null,
                        ])
                      : null
                  }`,
                })
              : h(Surface, {
                  title: t(mode === 'profile' ? 'login' : mode),
                  body: html`<form id="visitor-account" novalidate>${h(Stack, {
                    items: [
                      mode === 'register' ? field('name') : null,
                      field('email', '', 'email'),
                      mode === 'register'
                        ? h(Checkbox, { id: 'account-consent', name: 'consent', label: t('consent') })
                        : null,
                      mode === 'login' || mode === 'profile' ? field('code') : null,
                      button(mode === 'register' ? 'register' : mode === 'recovery' ? 'reset' : 'login'),
                    ],
                  })}</form>${mode === 'recovery' && result?.requestId ? html`<form id="visitor-recovery" novalidate><p>${t('expires')}: ${result.expiresAt}</p>${field('code')}${field('password', '', 'password')}<p>${t('passwordHelp')}</p>${button('recover', 'visitor-recovery')}</form>` : null}`,
                }),
            fragments(
              [
                ['visitor-register', 'register'],
                ['visitor-login', 'login'],
                ['visitor-recovery', 'reset'],
              ].map(([key, label]) =>
                h(LinkButton, {
                  label: t(label),
                  href: ctx.href(
                    key,
                    {},
                    { returnTo: safeVisitorReturn(route?.query?.returnTo, ctx.site().id) },
                  ),
                }),
              ),
            ),
          ],
        }),
      ),
    commands: Object.fromEntries(
      ['register', 'login', 'reset', 'recover', 'verify', 'logout', 'erase', 'profile'].map((action) => [
        `account.${mode}.${action}`,
        async (_args, form) => {
          result = await ctx.call('website_studio.visitorAccountCommand', {
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
  }
}
