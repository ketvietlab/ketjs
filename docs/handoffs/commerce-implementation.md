# Commerce UI implementation

The Commerce Atlas supplies the workflow and density reference. These changes use real domain
functions, persisted data, URL-owned record modals and server-rendered collection pages. They do not
install mock transport or change CRM / Customer Care.

## Public surfaces

- Purchase: operational overview with approval queue; RFQ and order collections open a shared modal
  for header, lines, receipts and bills. Vendor prices have a create/edit modal.
- Sale: operational overview, quotation/order modal, invoice-policy modal. Existing native detail
  URLs remain available for links and compatibility.
- Stock: overview and ten existing list/workspace surfaces; warehouse, location, operation type,
  lot, route and replenishment configuration modals; transfer modal; two-step inventory count.
  Lot inventory remains visible. Transfer links retain delivery/collaboration on the native detail.
- Product: existing production list, attribute and favorite surfaces are retained. The private
  deployment supplies the channel/publication extension.

## Data and permissions

`stock.previewInventoryCount` is a read operation in the stock operate capability. It returns the
base stock unit, difference, reserved quantity and an expected quant revision. Applying the count
uses the existing revision-checked `stock.adjustInventory`; preview does not change stock.

`sale.updateLine` edits a local, unlocked quotation only. `expectedRevision` is required. The
transaction compares the order revision before updating one line and totals; other quoted prices
are preserved. Confirmed and externally owned orders are refused.

Optional lookups use `ctx.allows` before calling. Modal routes distinguish create/read/write access
and return 404 for foreign-company records. Managed Commerce templates gain the required lookup
bundles and a version increment; deploy must synchronize those templates.

`currentCompanyContext(ctx)` narrows database queries and updates to the active company, in addition
to the framework's membership/branch checks, and retains that restriction inside transactions.
This is for workplace-owned commands: membership in another company does not imply a grant there.
It does not alter the caller's scope. Shared models retain their declared behavior.

## Verification

Relevant HTTP/domain and view suites cover quotation → delivery/invoice, RFQ → receipt/vendor bill,
inventory preview/stale confirmation, line revision conflicts, modal command schemas, bilingual
labels, read-only actions, managed role denial, company/branch grants and live revocation.
SQLite and isolated PostgreSQL lanes are used. Browser checks and combined private deployment
verification must be recorded separately; unit/HTTP counts are not browser E2E counts.
