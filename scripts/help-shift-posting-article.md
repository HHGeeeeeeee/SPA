# How money posts to ERP (Sales Remittance → Acumatica)

Every peso the POS touches lives on one ledger: the **folio**. Each folio line carries, from the moment it is created, everything ERP needs — a transaction code (the DR/CR accounts) and a DR/CR branch. Closing a shift on **Sales Remittance** turns those lines into exactly one GL journal in Acumatica.

```
order / SOA action ──→ folio line ──→ shift (Sales Remittance) ──→ GL journal
                       code + DR/CR branch        close shift        1 line = 1 DR/CR pair
                       decided HERE
```

Nothing else posts. Orders don't post. SOAs don't post. If it isn't a folio line in a shift, it never reaches the ERP.

---

## 1. Where the transaction code comes from

The code is never typed at the counter — it is resolved automatically from the thing you are doing:

| You do… | Code comes from |
|---|---|
| Finish a service (or charged interrupt) | the service category's **Revenue code** (Settings → Service Categories) |
| Add revenue / Adjust charge | the posting branch's **Default revenue code** (Settings → Branches) |
| Take a payment / refund — ordinary method | the payment method's **Transaction Code** (Settings → Payment Methods) |
| Take a payment / refund — **AR (on account)** | the billing destination's bound code (Settings → Billing Destinations) |
| Take a payment / refund — **Royal Card** | the branch's **Royal Card code** (Settings → Branches) |
| Record a tip | the branch's **Default tip code** (Settings → Branches) |
| Settle an SOA (full / partial / correction) | the payment method you pick in the dialog — an SOA settle **is an ordinary payment** |

If a binding is missing, the action is blocked with a message naming the Settings page to fix — nothing posts half-coded.

> **Accounts are pure configuration.** A code is just a DR/CR account pair. Which accounts an SOA settle hits depends only on which method you pick — e.g. a counter-cash method may post `DR 10108 / CR 40140`, while a bank method for AR collections posts `DR 10111 / CR <AR account>`. Set up one method per money flow and bind the right code to it.

## 2. Where the DR/CR branch comes from

Each folio line stamps a **DR branch** and a **CR branch** at posting time:

| Scenario | DR branch | CR branch |
|---|---|---|
| Service finish | the shift's branch | the **station's** branch (cross-branch work credits the performing store) |
| **AR (on account)** | the **DR branch override on the billing destination's bound transaction code** — the counterparty hotel's Acumatica segment (e.g. `HSR`). Empty override → the posting branch | the posting branch |
| Everything else | the posting branch you chose (= the shift the line lands in) | same |

A code's *Branch (override)* fields pin one leg to a fixed Acumatica segment; AR is the main user of this (the receivable leg books on the hotel being billed), but any code can use it.

By the time you open Sales Remittance, every line already knows its full `DR branch / account / sub` and `CR branch / account / sub`. There is nothing left to decide at close.

## 3. What the posted journal looks like

Closing a shift posts **one Journal Transaction**, dated to the business date, headed by the shift's branch, described `Sales remittance · <shift label>`.

- **1:1, no netting.** Every folio line becomes its own DR/CR pair. A payment and its refund both appear — the refund posts with the code's legs swapped and a `(refund)` / `(reversal)` suffix, amounts always positive.
- **Every detail line carries its source document** — the order number or SOA number — in both the **Ref. Number** field and the description (`PAYMAYA · SO-260601-0001`).
- A line whose code is missing a DR or CR account is skipped rather than posted half-balanced.

To preview a shift's journal without posting: `node scripts/simulate-shift-journal.mjs [shift_id]`.

## 4. SOA is paperwork, not posting

- **Generate SOA** only groups un-stated AR folio lines into a statement. No journal.
- **Void** releases them back. No journal.
- **Settle** posts an ordinary payment folio line into the open shift of the branch you choose — that line (not the SOA) reaches ERP at that shift's close. Partial amounts leave the statement `partial_paid`; a **negative amount** posts a refund line to correct a mistyped settle.
- **Unsettle** mirrors every settle line back as refunds and reopens the statement.

The AR charge itself (taking an AR payment on an order) already posted at charge time, in the shift where it was taken.

## 5. Posting status, retry & common errors

A closed shift shows its ERP state at the top of the Remittance card:

- **Posted to ERP · GL #F00190688** — done; the batch number is the Acumatica voucher.
- **ERP posting failed** + error — the shift is still closed; fix the cause and press **Retry post** (manager only). Posting is idempotent: an already-posted shift is never double-posted.
- **Not posted to ERP yet** — the close-time post was skipped (typically Acumatica wasn't configured). **Retry post** backfills it.

| Error | Cause / fix |
|---|---|
| *Not posted yet* on every shift | `ACUMATICA_*` environment variables missing — fill in BASE_URL, COMPANY, BRANCH, LEDGER_ID, API_VERSION, SERVICE_USERNAME, SERVICE_PASSWORD and restart |
| `403 insufficient rights … GL301000` | the service account lacks Journal Transaction access in Acumatica — grant it |
| `ACU_SESSION_REQUIRED` | the service-account login failed — check SERVICE_USERNAME / PASSWORD |
| *…has no transaction code bound* at the counter | a binding is missing — the message names the exact Settings page |

## 6. Setup checklist (per environment)

1. **Transaction Codes** — one row per money flow, DR/CR accounts + subs (global; branch optional, override fields only for fixed-segment legs).
2. **Payment Methods** — bind each method's code. Methods used to collect AR (bank, AR-cash) need codes whose CR side clears the receivable.
3. **Branches** — bind the three defaults: Revenue (manual), Tip, Royal Card.
4. **Billing Destinations** — bind each destination's AR charge code.
5. **Service Categories** — bind each category's revenue code.
6. **Acumatica env** — the seven `ACUMATICA_*` variables; the service account needs GL301000 rights.
