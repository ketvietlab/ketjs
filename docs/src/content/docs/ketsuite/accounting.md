---
title: Accounting ledger
description: How KetSuite posts, corrects and settles journal entries, and the currency arithmetic underneath.
---

# Accounting ledger

The `account` module holds the double-entry ledger: journals, entries, invoices,
payments, reconciliation and the three reports built on them. The bundled Vietnam
chart, taxes and journals that a company starts from are described in
[Vietnam accounting defaults](/ketsuite/accounting-tt99/).

## Currency arithmetic

Every stored amount is rounded to the minor unit of the currency that owns it, not to
a fixed two decimals. VND, JPY and KRW have no minor unit; BHD, KWD and TND have
three; everything else defaults to two.

This is not a display concern. A 1,234,567 VND invoice with 10% VAT rounded to two
decimals leaves an open item of 1,358,023.7 đồng, while the screen — which formats VND
with no decimals — prints 1,358,024 ₫. Paying the amount the screen shows is then
rejected for exceeding the open item, and the invoice can never be settled. Rounding
at the currency's own scale makes the number on the screen the number in the ledger.

The same scale governs the balance check when an entry is posted, the residual left
after a reconciliation, and the tolerance each comparison allows.

## Posting

`account.postMove` is the only way an entry enters the books. It refuses an entry with
fewer than two lines, a line carrying both a debit and a credit, a negative amount, or
a debit total that does not meet the credit total. On success it assigns the journal's
next sequence number through a compare-and-set retry, so concurrent posts produce
consecutive names with no gaps and no duplicates.

A manual entry has no totals of its own, so posting records them from the balanced
lines. An invoice keeps the totals its line builder computed.

## Correcting a posted entry

A posted entry is never edited and never deleted. `account.cancelMove` applies to
drafts only; the correction for anything already in the books is
`account.reverseMove`, which posts a second entry whose debits and credits are the
first one's, swapped.

```ts
// File: examples/accounting/reverse.ts
const result = await ctx.call('account.reverseMove', {
  id: postedMoveId,
  reversalId: crypto.randomUUID(),
})
// result.reversalId names the new entry; both stay in the ledger.
```

Where the original opened an item on a reconcilable account, the reversal closes it
against the original, so the document stops appearing in open items and in the partner
ledger. An invoice or bill that has been reversed carries `paymentState: 'reversed'`,
and later residual math leaves that label alone.

Both entries remain in the ledger and in every report — the trial balance nets to
zero rather than losing a row. Passing the same `reversalId` again returns the existing
reversal instead of posting a second one.

In the backend, a posted document offers **Reverse entry** on its own screen and takes
the reader to the resulting journal entry.

## Payments and reconciliation

`account.registerPayment` writes the liquidity and counterpart lines, posts them, and
optionally reconciles the counterpart against a chosen open item. The payment amount
is rounded to the currency scale before it is compared with the residual, so an amount
copied from the screen matches.

`account.reconcile` is the primitive underneath: it takes one debit line and one credit
line on the same reconcilable account, both posted, and records a partial reconcile for
an amount neither residual can be exceeded by. Both residuals move under
compare-and-set inside one transaction; a concurrent change fails the call rather than
producing a residual that does not match its reconciles. The documents on both sides
then have their payment state recomputed.

## Reports

`trialBalance`, `generalLedger` and `partnerStatement` read posted entries only. The
date window narrows the move query in the database, and journal items are fetched for
the moves that survive it, in chunks — a reporting window does not scan the whole
ledger and does not build a parameter list no driver will accept.

`generalLedger`, `partnerStatement`, `listMoves`, `listPayments` and `listOpenItems`
accept `limit` and `offset`. Paging is opt-in: a screen asks for a page, while an
export or a report asks for everything and gets it, rather than a silently truncated
list that reads as complete. `countMoves` answers the totals a dashboard needs without
fetching the rows.

## Which accounts a document posts to

An invoice does not ask. `lineAccountId` and `counterpartAccountId` are optional, and
when they are absent the ledger resolves them from configuration, narrowest first:

| | Revenue / expense | Receivable / payable |
| --- | --- | --- |
| 1 | what the caller passed | what the caller passed |
| 2 | the product's category | the partner |
| 3 | the company defaults | the company defaults |

Nothing at any level is a refusal, not a guess: `lineAccountUndecided` and
`counterpartAccountUndecided` say which one was undecided and where it could have come
from.

Asking the person writing an invoice to name a revenue account out of 216 is asking
them to re-answer a question the chart already answers the same way every time — and
to get it wrong occasionally. The fields remain on the form so an unusual document can
still say otherwise; they are simply no longer required.

### Where each level lives

- **Company** — `account.Defaults`, one row per company, on **Accounting → Default
  accounts**. Circular 99 answers this the same way for every Vietnamese company, so
  installation seeds it: revenue 511, cost of goods sold 632, receivables 1311,
  payables 3311. Only unset fields are ever seeded, so a company that chose
  differently keeps its choice.
- **Product category** — `account.CategoryAccount`, on the same screen. The catalogue
  is shared across every company in the tenant while a chart of accounts belongs to
  one, so the mapping cannot live on the category itself: two companies file the same
  category against different accounts.
- **Partner** — `partner.CompanyTerms`, on the partner's own accounting screen, added
  by the optional `account_partner` module. The resolver reads those fields rather
  than depending on the module: without it they are simply absent and resolution falls
  through to the company default.

A default is checked when it is saved, not when an invoice fails: a receivable default
must be a receivable account, a revenue default an income account. `account.saveDefaults`
and `account.saveCategoryAccount` refuse anything else, and `account.previewAccounts`
answers what a document *would* post to, and what decided it.

```ts
// File: examples/accounting/defaults.ts
// Everything below the journal and the partner is optional.
await ctx.call('account.createInvoice', {
  id: invoiceId,
  journalId: saleJournalId,
  moveType: 'out_invoice',
  partnerId,
  productId,
  description: 'Tư vấn triển khai',
  quantity: '1',
  priceUnit: '3000000',
})
```

## Refusals

Every function answers a rejected call with `{ ok: false, errors: [{ field, code,
message }] }`. The `code` is a message key this module owns — the rule belongs to the
ledger, so the wording does too, and a screen renders it in the reader's language. The
`message` is the same reason in English, for an API client or a log with no translator.

A backend screen re-renders the form it was given rather than redirecting: the reason
appears against the field that caused it, and the values the user typed are still
there. A long invoice form is not worth re-keying because one account was the wrong
type.

## Configuration is editable

Accounts, journals, taxes and payment terms are corrected in place from their own list
screens: following a row opens `?edit=<id>`, which prefills the create form and posts
back to the same id. Clearing **In use** archives the record, which removes it from
selection lists while leaving every entry that already references it intact. Archived
rows stay visible on the configuration screen, with an `Archived` badge, so the change
can be undone.

A payment term's milestones are listed and edited the same way, through `?editLine=`.
A term is defined by them — a percentage, a due-date rule and a number of days — so
counting them without showing them left the screen unable to say what "30 days" meant.

The `save*` functions take the same shape for a correction as for a creation: an id
that already exists updates, an id that does not creates.

## What the screens promise

A few things the backend guarantees, because getting them wrong makes a screen unusable
rather than merely untidy:

- a picker only offers values the function will accept — a payment's destination lists
  receivable and payable accounts, not all 216;
- a dashboard card counts exactly the list it opens;
- a draft has no journal number yet, so lists and titles name it by its kind and date
  rather than by the raw id it was created under;
- a payment state is shown only on documents that have one, never on a manual entry;
- creating a document opens it, because a new invoice or entry is a draft that still
  needs lines or posting.

## Testing

`test/accounting.test.ts` covers tax computation, due dates, balanced posting, sequence
assignment under concurrency, partial payment and reconciliation, VND settlement at the
displayed amount, compounding taxes, reversal, and manual entry totals.
`test/account-tt99.test.ts` covers installation, catalog upgrade — both the additive and
the corrective path — and refusal of unsupported countries. `test/accounting-e2e.test.ts`
drives the real HTTP backend through the invoice, payment and report workflow, through
correcting and archiving a chart entry, and through reversing a posted document.
