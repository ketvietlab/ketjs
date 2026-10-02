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
import { CommandButton } from '../ui.tsx'
import { publicFrame } from './visitor-commerce.tsx'
import { destinationStatus, formatDate, formatTime, newId } from './format.ts'
import type { FormField, Screen, StudioContext } from '../types.ts'

/** Where an ERP-routed submission went and where it stands there. */
type Destination = {
  title: string
  state: string
  outcome?: string | null
  status?: string | null
  attempts?: number
  syncedAt?: string | null
  error?: string | null
  href?: string | null
}
/** `website_studio.submissionDetail`: one submission, read under audit. */
type SubmissionDetail = {
  form: { id: string; title: string }
  labels: Record<string, string>
  submission: {
    id: string
    receipt: string
    fields: Record<string, unknown>
    formRevisionId?: string | null
    consentVersion?: string | null
    retentionUntil?: string | null
    delivery?: {
      attempt?: number
      state?: string
      recipient?: string | null
      attempts?: { attempt: number; at: string; state: string }[]
    } | null
    destination?: Destination | null
    audit?: { at: string; action: string }[]
  }
}
/** `website_studio.visitorForm`: the published form a visitor fills in. */
type VisitorFormData = {
  form: { id: string; title: string; successMessage?: string; spamProtection?: string; consentLabel?: string }
  fields: FormField[]
}

/**
 * The ERP module this submission was handed to, in that module's words. The Website keeps its own
 * copy; this says where the request went and where it stands there.
 */
const destinationBlock = (ctx: StudioContext, destination: Destination | null | undefined) =>
  destination ? (
    <Stack
      items={[
        <DescriptionList
          layout="strip"
          items={[
            {
              id: 'destination',
              label: ctx.tr('website.formJourney.destination'),
              value: destination.title,
            },
            {
              id: 'destination-state',
              label: ctx.tr('website.formJourney.destinationState'),
              value: (
                <Status
                  {...destinationStatus(ctx.tr, destination.state, destination.outcome, destination.status)}
                />
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
          ]}
        />,
        // A failure waits for a person; a fault still being retried says so without a button.
        destination.error ? (
          <Notice
            title={ctx.tr(
              destination.state === 'failed'
                ? 'website.formJourney.destinationFailed'
                : 'website.formJourney.destinationRetrying',
            )}
            message={destination.error}
            tone={destination.state === 'failed' ? 'danger' : 'warning'}
            actions={
              destination.state === 'failed' ? (
                <CommandButton
                  label={ctx.tr('website.formJourney.retryDestination')}
                  command="submission.retryDestination"
                  disabled={ctx.busy() || !ctx.can('website.submission.manage')}
                />
              ) : null
            }
          />
        ) : null,
      ]}
    />
  ) : null

export function createSubmissionDetail(ctx: StudioContext) {
  let current: SubmissionDetail
  return {
    readKey: (route) => route.params.id,
    read: async (route, signal) =>
      (current = await ctx.call<SubmissionDetail>(
        'website_studio.submissionDetail',
        { siteId: ctx.site().id, id: route.params.id },
        { signal },
      )),
    view: (data) => (
      <RecordPage
        width="wide"
        title={ctx.tr('website.submission.title', { form: data.form.title })}
        actions={
          <>
            <LinkButton
              label={ctx.tr('website.resource.back')}
              href={ctx.href('submissions', { id: data.form.id })}
            />
            {data.submission.destination?.href ? (
              <LinkButton
                label={ctx.tr('website.formJourney.openDestination')}
                href={data.submission.destination.href}
              />
            ) : null}
          </>
        }
        body={
          <Surface
            title={ctx.tr('website.submission.content')}
            body={
              <Stack
                items={[
                  <DescriptionList
                    items={Object.entries(data.submission.fields).map(([key, value]) => ({
                      id: key,
                      label: data.labels[key] ?? key,
                      value: String(value),
                    }))}
                  />,
                  <DescriptionList
                    layout="strip"
                    items={[
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
                        value: formatDate(data.submission.retentionUntil),
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
                    ]}
                  />,
                  // Only the fixture host simulates a delivery; a real one reports none here.
                  data.submission.delivery ? (
                    <Notice
                      title={ctx.tr('website.formJourney.deliveryMock')}
                      message={ctx.tr('website.formJourney.deliveryMockHelp')}
                      tone="info"
                      actions={
                        ['pending', 'failed'].includes(data.submission.delivery?.state ?? '') ? (
                          <CommandButton
                            label={ctx.tr(
                              data.submission.delivery.state === 'failed'
                                ? 'website.formJourney.retry'
                                : 'website.formJourney.process',
                            )}
                            command="submission.process"
                            disabled={ctx.busy() || !ctx.can('website.submission.manage')}
                          />
                        ) : null
                      }
                    />
                  ) : null,
                  data.submission.delivery ? (
                    <DataTable
                      emptyTitle={ctx.tr('website.formJourney.attemptsEmpty')}
                      emptyMessage={ctx.tr('website.formJourney.attemptsEmptyHelp')}
                      rows={data.submission.delivery.attempts ?? []}
                      id={(r) => String(r.attempt)}
                      columns={[
                        {
                          key: 'attempt',
                          label: ctx.tr('website.formJourney.attempt'),
                          cell: (r) => r.attempt,
                        },
                        {
                          key: 'at',
                          label: ctx.tr('website.formJourney.at'),
                          cell: (r) => formatTime(r.at),
                          kind: 'date',
                        },
                        {
                          key: 'state',
                          label: ctx.tr('website.formJourney.delivery'),
                          cell: (r) => ctx.tr(`website.delivery.${r.state}`),
                        },
                      ]}
                    />
                  ) : null,
                  destinationBlock(ctx, data.submission.destination),
                  <DataTable
                    emptyTitle={ctx.tr('website.formJourney.auditEmpty')}
                    emptyMessage={ctx.tr('website.formJourney.auditEmptyHelp')}
                    rows={data.submission.audit ?? []}
                    // An audit event has no id of its own; its place in the trail names its row.
                    id={(r) => String(data.submission.audit!.indexOf(r))}
                    columns={[
                      {
                        key: 'at',
                        label: ctx.tr('website.formJourney.at'),
                        cell: (r) => formatTime(r.at),
                        kind: 'date',
                      },
                      {
                        key: 'action',
                        label: ctx.tr('website.formJourney.audit'),
                        cell: (r) => ctx.tr(`website.submission.audit.${r.action}`),
                      },
                    ]}
                  />,
                ]}
              />
            }
          />
        }
      />
    ),
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
  } satisfies Screen<SubmissionDetail>
}

export function createVisitorForm(ctx: StudioContext) {
  let requestId = newId('submission')
  let sent = false
  let receipt: string | null = null
  let formKey: string | undefined
  let loaded: VisitorFormData
  return {
    readKey: (route) => route.params.id,
    read: async (route, signal) => {
      const nextKey = `${ctx.site().id}:${route.params.id}`
      if (formKey !== nextKey) {
        formKey = nextKey
        sent = false
        requestId = newId('submission')
      }
      loaded = await ctx.call<VisitorFormData>(
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
        <Surface
          body={
            data.sent ? (
              <Notice
                title={ctx.tr('website.formJourney.sent')}
                message={`${data.form.successMessage || ctx.tr('website.formJourney.success')} · ${ctx.tr('website.formJourney.receipt')}: ${receipt}`}
                tone="positive"
              />
            ) : (
              <form id="visitor-form" novalidate>
                <Stack
                  items={[
                    ...data.fields.map((field) => {
                      const props = {
                        id: `visitor-${field.name}`,
                        name: field.name,
                        label: field.label,
                        required: field.required,
                        maxLength: field.maxLength,
                      }
                      return field.type === 'textarea' ? (
                        <TextArea {...props} />
                      ) : (
                        <TextField
                          {...props}
                          type={field.type === 'email' || field.type === 'tel' ? field.type : 'text'}
                        />
                      )
                    }),
                    data.form.spamProtection === 'challenge' ? (
                      <TextField
                        id="visitor-challenge"
                        name="challenge"
                        label={ctx.tr('website.formJourney.challenge')}
                        required
                      />
                    ) : (
                      // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the honeypot is `hidden` and out of the tab order; aria-hidden keeps assistive technology from offering it.
                      <input
                        type="text"
                        name="honeypot"
                        hidden
                        tabindex="-1"
                        autocomplete="off"
                        aria-hidden="true"
                      />
                    ),
                    <Checkbox
                      id="visitor-consent"
                      name="consent"
                      value="yes"
                      label={data.form.consentLabel || ctx.tr('website.formJourney.consent')}
                    />,
                  ]}
                />
                <CommandButton
                  label={ctx.tr('website.formJourney.send')}
                  command="visitor.submit"
                  type="submit"
                  form="visitor-form"
                  variant="primary"
                  disabled={ctx.busy()}
                />
              </form>
            )
          }
        />,
      ),
    commands: {
      'visitor.submit': async (_args, form) => {
        form = form!
        const result = await ctx.call<{ preview?: boolean; receipt: string }>(
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
  } satisfies Screen<VisitorFormData & { sent: boolean }>
}

export function createVisitorReceipt(ctx: StudioContext) {
  return {
    readKey: (route) => route.params.id,
    read: (route, signal) =>
      ctx.call<{ receipt: string; createdAt: string }>(
        'website_studio.submissionReceipt',
        { siteId: ctx.site().id, id: route.params.id },
        { signal },
      ),
    view: (data) =>
      publicFrame(
        ctx,
        ctx.tr('website.formJourney.sent'),
        <Surface
          body={
            <Notice
              title={data.receipt}
              message={`${ctx.tr('website.formJourney.next')} · ${data.createdAt}`}
              tone="positive"
              actions={<LinkButton label={ctx.tr('website.overview.openSite')} href={ctx.href('public')} />}
            />
          }
        />,
      ),
  } satisfies Screen<{ receipt: string; createdAt: string }>
}
