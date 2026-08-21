---
title: Vietnam accounting defaults under Circular 99
description: KetSuite's mandatory Vietnam TT99 chart, taxes, journals, and installation behavior.
---

# Vietnam accounting defaults under Circular 99

KetSuite ships Vietnam accounting defaults inside the `account` module. There is no
separate localization application to install: an Accounting workspace without its
statutory chart, taxes and journals is not a usable Accounting installation.

## Legal basis and effective date

The single supported Vietnam catalog is `TT99_2025`, based on Appendix II of Circular
99/2025/TT-BTC dated 27 October 2025. It applies to financial years beginning on or
after 1 January 2026 and replaces the former Circular 200 chart. KetSuite does not
offer a Circular 200 selector.

The bundled chart contains 216 unique operational leaf accounts covering all 71
level-one account families in Circular 99. Distinguishing changes include account
215 for biological assets, account 82112 for global minimum tax, the renamed account
242 for expenses awaiting allocation, and removal of former accounts 161 and 461.

## Company initialization

The first Accounting read initializes the active company in one transaction. The
operation is idempotent and safe when several requests arrive concurrently. It creates:

- the Circular 99 chart of accounts;
- Vietnam sale and purchase VAT rates, KCT, KKKNT, import VAT and import tax;
- sale, purchase, bank, cash and general journals;
- immediate and net-30 payment terms;
- an `account.Setup` audit row containing the country, standard, legal basis,
  source checksum and installation timestamp.

Initialization never overwrites an existing account with the same company and code.
Default journals resolve the retained account by code, so a company may prepare its
own bank or cash account before opening Accounting. A non-Vietnam company is rejected
clearly; KetSuite must not silently install Vietnam rules based on an unrelated
currency or country.

The catalog checksum also supports additive upgrades. When a newer bundled catalog is
available, the next Accounting request inserts missing defaults and updates the setup
audit row without overwriting company-owned records. The KKKNT addition uses this path,
so an existing TT99 company does not need its database recreated.

## Tax posting

Each non-zero default tax points to its statutory posting account. Invoice creation
uses that account automatically when the caller does not explicitly supply one:

- deductible purchase VAT uses account 1331;
- output sale VAT uses account 33311;
- import tax uses account 33331 and participates in the tax base.

`KCT` and `KKKNT` are separate zero-amount classifications. KCT means the goods or
services are not subject to VAT. KKKNT means the transaction is not declared or used
to calculate VAT payable. Both sale and purchase scopes are bundled because KetSuite,
like the domain contract, keeps those selectable tax directions separate. Neither creates a tax
posting line or points to a tax account.

The technical classification of account 411121 is `liability_current`. This corrects
an the domain contract localization mapping that labels the account as a liability but classifies
it as equity.

## Verification

Targeted tests verify the account count and checksum, TT99 markers, retired account
absence, concurrent initialization, preservation of pre-existing codes, automatic tax
posting and refusal of unsupported countries. The HTTP E2E starts with an empty company,
opens the real Accounting dashboard and completes an invoice/payment/report workflow
using only the automatically installed defaults.

The pre-commit PostgreSQL benchmark creates a fresh schema and measures the
one-time setup separately from warm reads. On the development database used for
this change, the final run measured 335.096 ms p95 for installing all 216
accounts, 4.534 ms p95 for a warm account-list read, and 14.8 companies/second
while initializing eight companies concurrently. Setup is deliberately lazy and
runs once per company; normal accounting requests use the warm path.

Browser evidence for the Vietnamese and English desktop/mobile layouts is stored
under `docs/public/screenshots/accounting/`.
