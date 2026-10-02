import { html } from '@ketvietlab/ketjs-view'
import {
  RecordPage,
  DataTable,
  Surface,
  Stack,
  TextField,
  TextArea,
  Checkbox,
  DescriptionList,
  Notice,
  LinkButton,
  Status,
} from '@ketvietlab/design-system'
import { h, CommandButton } from '../ui.mjs'
import { publicFrame } from './visitor-commerce.mjs'
import { destinationStatus, formatTime, newId } from './format.mjs'

/**
 * The ERP module this submission was handed to, in that module's words. The Website keeps its own
 * copy; this says where the request went and where it stands there.
 */
const destinationBlock = (ctx, destination) =>
  destination
    ? h(Stack, {
        items: [
          h(DescriptionList, {
            layout: 'strip',
            items: [
              {
                id: 'destination',
                label: ctx.tr('website.formJourney.destination'),
                value: destination.title,
              },
              {
                id: 'destination-state',
                label: ctx.tr('website.formJourney.destinationState'),
                value: h(
                  Status,
                  destinationStatus(ctx.tr, destination.state, destination.outcome, destination.status),
                ),
              },
              {
                id: 'destination-attempts',
                label: ctx.tr('website.formJourney.destinationAttempts'),
                value: String(destination.attempts ?? 0),
              },
              {
                id: 'destination-synced',
                label: ctx.tr('website.formJourney.destinationSynced'),
                value: formatTime(destination.syncedAt),
              },
            ],
          }),
          // A failure waits for a person; a fault still being retried says so without a button.
          destination.error
            ? h(Notice, {
                title: ctx.tr(
                  destination.state === 'failed'
                    ? 'website.formJourney.destinationFailed'
                    : 'website.formJourney.destinationRetrying',
                ),
                message: destination.error,
                tone: destination.state === 'failed' ? 'danger' : 'warning',
                actions:
                  destination.state === 'failed'
                    ? CommandButton({
                        label: ctx.tr('website.formJourney.retryDestination'),
                        command: 'submission.retryDestination',
                        disabled: ctx.busy() || !ctx.can('website.submission.manage'),
                      })
                    : null,
              })
            : null,
        ],
      })
    : null

export function createSubmissionDetail(ctx) {
  let current
  return {
    readKey: (route) => route.params.id,
    read: async (route, signal) =>
      (current = await ctx.call(
        'website_studio.submissionDetail',
        { siteId: ctx.site().id, id: route.params.id },
        { signal },
      )),
    view: (data) =>
      h(RecordPage, {
        width: 'wide',
        title: data.form.title,
        actions: html`${h(LinkButton, {
          label: ctx.tr('website.resource.back'),
          href: ctx.href('submissions', { id: data.form.id }),
        })}${
          data.submission.destination?.href
            ? h(LinkButton, {
                label: ctx.tr('website.formJourney.openDestination'),
                href: data.submission.destination.href,
              })
            : null
        }`,
        body: h(Surface, {
          title: ctx.tr('website.submission.content'),
          body: h(Stack, {
            items: [
              h(DescriptionList, {
                items: Object.entries(data.submission.fields).map(([key, value]) => ({
                  id: key,
                  label: data.labels[key] ?? key,
                  value: String(value),
                })),
              }),
              h(DescriptionList, {
                layout: 'strip',
                items: [
                  {
                    id: 'receipt',
                    label: ctx.tr('website.formJourney.receipt'),
                    value: data.submission.receipt,
                  },
                  {
                    id: 'revision',
                    label: ctx.tr('website.resource.revision'),
                    value: data.submission.formRevisionId ?? '—',
                  },
                  {
                    id: 'consent',
                    label: ctx.tr('website.site.consentVersion'),
                    value: data.submission.consentVersion ?? '—',
                  },
                  {
                    id: 'retention',
                    label: ctx.tr('website.formJourney.retention'),
                    value: data.submission.retentionUntil ?? '—',
                  },
                  {
                    id: 'delivery',
                    label: ctx.tr('website.formJourney.delivery'),
                    value: data.submission.delivery
                      ? ctx.tr(`website.delivery.${data.submission.delivery.state ?? 'pending'}`)
                      : '—',
                  },
                  {
                    id: 'recipient',
                    label: ctx.tr('website.resource.form-editor.recipient'),
                    value: data.submission.delivery?.recipient ?? '—',
                  },
                ],
              }),
              // Only the fixture host simulates a delivery; a real one reports none here.
              data.submission.delivery
                ? h(Notice, {
                    title: ctx.tr('website.formJourney.deliveryMock'),
                    message: ctx.tr('website.formJourney.deliveryMockHelp'),
                    tone: 'info',
                    actions: ['pending', 'failed'].includes(data.submission.delivery?.state)
                      ? CommandButton({
                          label: ctx.tr(
                            data.submission.delivery.state === 'failed'
                              ? 'website.formJourney.retry'
                              : 'website.formJourney.process',
                          ),
                          command: 'submission.process',
                          disabled: ctx.busy() || !ctx.can('website.submission.manage'),
                        })
                      : null,
                  })
                : null,
              data.submission.delivery
                ? h(DataTable, {
                    emptyTitle: ctx.tr('website.resource.empty'),
                    emptyMessage: ctx.tr('website.resource.emptyHelp'),
                    rows: data.submission.delivery.attempts ?? [],
                    id: (r) => r.attempt,
                    columns: [
                      {
                        key: 'attempt',
                        label: ctx.tr('website.formJourney.attempt'),
                        cell: (r) => r.attempt,
                      },
                      { key: 'at', label: ctx.tr('website.entry.updated'), cell: (r) => r.at },
                      {
                        key: 'state',
                        label: ctx.tr('website.formJourney.delivery'),
                        cell: (r) => ctx.tr(`website.delivery.${r.state}`),
                      },
                    ],
                  })
                : null,
              destinationBlock(ctx, data.submission.destination),
              h(DataTable, {
                emptyTitle: ctx.tr('website.resource.empty'),
                emptyMessage: ctx.tr('website.resource.emptyHelp'),
                rows: data.submission.audit ?? [],
                id: (_r, i) => i,
                columns: [
                  { key: 'at', label: ctx.tr('website.entry.updated'), cell: (r) => r.at },
                  {
                    key: 'action',
                    label: ctx.tr('website.formJourney.audit'),
                    cell: (r) => ctx.tr(`website.submission.audit.${r.action}`),
                  },
                ],
              }),
            ],
          }),
        }),
      }),
    commands: {
      'submission.process': async () => {
        await ctx.call('website_studio.processSubmissionDelivery', {
          siteId: ctx.site().id,
          id: current.submission.id,
          expectedAttempt: current.submission.delivery?.attempt ?? 0,
        })
        await ctx.refresh()
      },
      'submission.retryDestination': async () => {
        await ctx.call('website_form.retryDelivery', { siteId: ctx.site().id, id: current.submission.id })
        ctx.notify(ctx.tr('website.formJourney.destinationQueued'))
        await ctx.refresh()
      },
    },
  }
}

export function createVisitorForm(ctx) {
  let requestId = newId('submission')
  let sent = false
  let receipt = null
  let formKey
  let loaded
  return {
    readKey: (route) => route.params.id,
    read: async (route, signal) => {
      const nextKey = `${ctx.site().id}:${route.params.id}`
      if (formKey !== nextKey) {
        formKey = nextKey
        sent = false
        requestId = newId('submission')
      }
      loaded = await ctx.call(
        'website_studio.visitorForm',
        { siteId: ctx.site().id, id: route.params.id },
        { signal },
      )
      return { ...loaded, sent }
    },
    view: (data) =>
      publicFrame(
        ctx,
        data.form.title,
        h(Surface, {
          body: data.sent
            ? h(Notice, {
                title: ctx.tr('website.formJourney.sent'),
                message: `${data.form.successMessage || ctx.tr('website.formJourney.success')} · ${ctx.tr('website.formJourney.receipt')}: ${receipt}`,
                tone: 'positive',
              })
            : html`<form id="visitor-form" novalidate>${h(Stack, {
                items: [
                  ...data.fields.map((field) =>
                    h(field.type === 'textarea' ? TextArea : TextField, {
                      id: `visitor-${field.name}`,
                      name: field.name,
                      label: field.label,
                      required: field.required,
                      maxLength: field.maxLength,
                      type: field.type === 'email' || field.type === 'tel' ? field.type : 'text',
                    }),
                  ),
                  data.form.spamProtection === 'challenge'
                    ? h(TextField, {
                        id: 'visitor-challenge',
                        name: 'challenge',
                        label: ctx.tr('website.formJourney.challenge'),
                        required: true,
                      })
                    : html`<input type="text" name="honeypot" hidden tabindex="-1" autocomplete="off" aria-hidden="true" />`,
                  h(Checkbox, {
                    id: 'visitor-consent',
                    name: 'consent',
                    value: 'yes',
                    label: data.form.consentLabel || ctx.tr('website.formJourney.consent'),
                  }),
                ],
              })}${CommandButton({ label: ctx.tr('website.formJourney.send'), command: 'visitor.submit', type: 'submit', form: 'visitor-form', variant: 'primary', disabled: ctx.busy() })}</form>`,
        }),
      ),
    commands: {
      'visitor.submit': async (_args, form) => {
        const result = await ctx.call(
          'website_studio.submitVisitorForm',
          {
            siteId: ctx.site().id,
            formId: loaded.form.id,
            id: requestId,
            consent: form.has('consent'),
            honeypot: String(form.get('honeypot') ?? ''),
            challenge: String(form.get('challenge') ?? ''),
            fields: Object.fromEntries(
              loaded.fields.map((field) => [field.name, String(form.get(field.name) ?? '')]),
            ),
          },
          { key: requestId },
        )
        // The production Studio checks a preview post against the saved form and stores nothing.
        if (result.preview) {
          ctx.notify(ctx.tr('website.formJourney.previewChecked'))
          return
        }
        receipt = result.receipt
        sent = true
        requestId = newId('submission')
        await ctx.navigate('visitor-receipt', { id: receipt })
      },
    },
  }
}

export function createVisitorReceipt(ctx) {
  return {
    readKey: (route) => route.params.id,
    read: (route, signal) =>
      ctx.call(
        'website_studio.submissionReceipt',
        { siteId: ctx.site().id, id: route.params.id },
        { signal },
      ),
    view: (data) =>
      publicFrame(
        ctx,
        ctx.tr('website.formJourney.sent'),
        h(Surface, {
          body: h(Notice, {
            title: data.receipt,
            message: `${ctx.tr('website.formJourney.next')} · ${data.createdAt}`,
            tone: 'positive',
            actions: h(LinkButton, { label: ctx.tr('website.overview.openSite'), href: ctx.href('public') }),
          }),
        }),
      ),
  }
}
