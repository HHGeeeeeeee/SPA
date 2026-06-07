# Accounts Receivable — from charge to settlement

## How AR works here

Accounts receivable (AR) is a **bill-to-account** charge: instead of the guest paying at the counter, the bill is owed by a billing destination (a hotel / partner). The whole flow runs on **folio lines**:

1. **Charge on account** — record an AR payment line on the order (method = AR), tagged with a **Bill to** and a **guest**.
2. **Generate SOA** — group a billing destination's unbilled AR lines into a Statement of Account.
3. **Settle** — clear the statement with one settle line that posts into the branch's open shift (and from there to ERP when the shift closes).

> The Statement of Account is built from the AR folio lines, not from whole orders. An order can be part cash and part on account — only the AR part lands on the SOA.

**Prerequisites**

- The **Bill to** (billing destination) must have a transaction code bound — *Settings → Billing Destinations*.
- An **open shift** is needed both to record an AR charge and to settle (every posting binds to a shift).

---

## Step 1 — Charge on account

On the order, in the Folio section → **Payments card → Add payment**:

1. **Method**: pick **AR**.
2. Picking AR reveals two required fields:
   - **Bill to** — defaults from the order header (the hotel/partner the order is billed to); editable.
   - **Guest** — who the service is for (the SOA must show a name).
3. **Transaction Code** is read-only and resolves automatically from the Bill to.
4. Enter the **Amount** and submit.

This posts an AR folio line on the order (method = AR), stamped with the Bill to + guest. The order's balance is now covered "on account".

- **Refund on account**: Payments card → **Add refund** with method = AR (same Bill to + guest). A refund reduces what the billing destination owes.

---

## Step 2 — Generate the Statement of Account (manager)

Go to **Reconciliation → Accounts Receivable** → **Generate SOA** tab.

1. Pick a **date range**. Every **unbilled** AR line (not yet on any SOA) whose order falls in range is grouped by **Bill to × branch** — one statement per group.
2. Expand a group to review its orders / guests / amounts.
3. Tick the groups you want and click **Generate SOA**.

Each group becomes a statement (status **Issued**) and its AR lines are stamped onto that SOA. Third-party destinations also get a due date from their credit terms.

- **Print**: in **SOA History**, select one or more statements and **Download PDF** (a single PDF, or a ZIP for several). The PDF lists each guest, service and amount.

---

## Step 3 — Settle the statement (manager)

Settle an open statement from **AR Balance**; reverse or void it from **SOA History**.

1. On an open statement, click **Settle**.
2. In the dialog: pick a **Method** (cash / bank), optionally attach a **proof** (cash photo / remittance slip), submit.
3. This posts **one settle folio line** into the branch's open shift, marks every AR line in the statement as settled, and flips the SOA to **Settled** (outstanding → 0).

Because the settle line lands in the shift, it appears in **Sales Remittance** and is posted to ERP when that shift is closed (one GL journal per shift). There is no separate "post to ERP" step on the SOA.

### Reversing / cancelling

- **Unsettle** (SOA History, on a settled statement): posts a negative settle line into the open shift, clears the settle reference on every line, and reopens the SOA as **Issued**. Use this when a settlement was wrong.
- **Void** (SOA History, on an issued / unsettled statement): voids the statement and releases its AR lines back to the Generate pool so they can be re-stated. A settled statement must be **Unsettled** first.

---

## Fixing a wrong amount (e.g. overcharged)

If a statement was billed for too much, correct it like this — **the amounts must be fixed on the order, then the statement re-issued**:

1. **If the statement is already Settled** → **Unsettle** it first (SOA History) so it is back to Issued.
2. **Void the SOA** (SOA History) — this releases its AR lines back to the unbilled pool so they can be re-stated.
3. On the order, fix the money:
   - **Adjust charge** (Revenue card, manager PIN) — enter the over-charged amount to take it off revenue (posts a negative revenue line).
   - **Add refund** with method = **AR** (Payments card) — the same amount, to reduce what the billing destination owes.
4. **Re-generate the SOA** (Generate SOA) — the corrected net (original charge minus the refund) lands on a fresh statement.

> Why void before re-generating? The original AR line is locked to the old statement until you Void it. Re-generating without voiding would only pick up the new refund line and miss the original — Void releases both so the new SOA nets correctly.

For an **under**charge, do the opposite on the order — **Add revenue** + **Add payment** with method = AR — then re-generate.

---

## AR Balance — the receivables ledger

**Reconciliation → Accounts Receivable → AR Balance** shows what each billing destination owes:

- **Unbilled** — AR charges not yet on a statement.
- **Outstanding** — issued statements not yet settled, split **Current** vs **Overdue** (past the due date, third-party).
- **Total owed** = unbilled + outstanding.

Expand a destination to see its open statements and settle them.

---

## Quick reference

| Step | Where | Who | Result |
| --- | --- | --- | --- |
| Charge on account | Order → Folio → Add payment (method = AR) | Staff | AR folio line (Bill to + guest) |
| Generate SOA | Reconciliation → AR → Generate SOA | Manager | Statement (Issued); lines grouped |
| Settle | AR Balance / SOA → Settle | Manager | Settle line into shift; SOA Settled |
| Unsettle | SOA History → Unsettle | Manager | Reverses settle; SOA back to Issued |
| Void | SOA History → Void | Manager | Issued SOA voided; lines released |

## FAQ

- **Why a guest on an AR charge?** The statement must show who each line is for, so AR Add payment / refund require a guest.
- **Where does the money hit ERP?** Not at settle time directly — the settle line goes into the shift, and the shift posts one GL journal when it is closed (Sales Remittance).
- **Can't pick AR / no transaction code shows?** The Bill to has no transaction code bound — set it in *Settings → Billing Destinations*.
- **Can't Settle / Add payment?** The branch has no open shift. Open one on **Sales Remittance** first.
- **A statement was overcharged.** Unsettle (if settled) → Void the SOA → on the order Adjust charge + Add refund (method = AR) → re-generate the SOA. See *Fixing a wrong amount* above.