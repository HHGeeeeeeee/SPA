# Charging for an interrupted service (full / partial / free)

## First, the key rule: interrupting does NOT change the money

The moment a service is **Started** (goes *in service*), the system posts a **full revenue** folio line on the order (the service's final amount).

When you **Interrupt** a running service, the system only does two things:

1. Marks the service *interrupted* and records the **reason** plus the **charge intent** you picked (Full charge / No charge);
2. It does **not** automatically reverse or adjust that revenue.

> In other words: picking "No charge" on Interrupt only records intent — **the money is not reduced automatically**. The actual charge / waiver is always done by hand in the Folio section below, using **Add payment** and **Adjust charge**. That way the folio ledger and the order total never silently drift apart.

**Prerequisite for every case**: each folio action (Add payment / Adjust charge) needs an **open shift** for that branch. With no open shift the dialog shows a "please open a shift" hint — open one on Sales Remittance first.

---

## Common first step: Interrupt the service

On the order's service row (or the board), click **Interrupt** on the running service → pick Handling (Full charge / No charge) + Reason → submit.

- Picking **No charge** requires a **manager PIN** (staff can't waive a charge on their own).
- The Handling choice is only an intent record; the actual money is still handled by one of the three cases below.

After interrupting, work in the order's **Folio** section:

- **Revenue card**: `Add revenue`, `Adjust charge`
- **Payments card**: `Add payment`, `Add refund`

---

## Case 1: Full charge — just Add payment

The service was interrupted but you still charge full price. Revenue is already the full amount, so **no adjustment is needed**.

1. Payments card → **Add payment**
2. Pick Branch / Method, enter the amount (full), submit.

Done. Revenue = full, collected = full, balanced.

---

## Case 2: Partial charge — Adjust charge first (manager), then Add payment

You only charge part of it (e.g. list price ₱1,000, you collect only ₱600). First deduct the **part you are NOT charging** from revenue, then collect the actual amount.

1. Revenue card → **Adjust charge** (needs **manager PIN**)
   - "Amount to deduct": enter the **amount to take off** (= the part not charged, here **₱400**)
   - Enter a Reason
   - Enter the manager PIN (single masked field; any manager's PIN works)
   - Submit → the system posts a **−₱400** revenue line
2. Payments card → **Add payment**, collect the **actual amount ₱600**.

Done. Net revenue = 1,000 − 400 = **₱600**, collected = ₱600, balanced.

> Key point: Adjust charge takes the **positive amount you want to deduct** — the system turns it into a negative posting. Do not enter the amount you are collecting.

---

## Case 3: Free — Adjust charge the full amount (manager PIN), no payment

Nothing is charged (e.g. a fully waived complaint). Reverse the full revenue; no payment needed.

1. Revenue card → **Adjust charge** (needs **manager PIN**)
   - "Amount to deduct": enter the **full amount** (₱1,000)
   - Enter a Reason
   - Enter the manager PIN
   - Submit → the system posts a **−₱1,000** revenue line
2. **No** Add payment.

Done. Net revenue = 1,000 − 1,000 = **₱0**, collected = ₱0, balanced.

---

## Quick reference

| Case | Adjust charge (amount to deduct) | Add payment (collect) | Manager needed? |
| --- | --- | --- | --- |
| Full charge | — | full | No |
| Partial charge | the part not charged | actual collected | Yes (Adjust charge) |
| Free | full | — | Yes (Adjust charge) |

## FAQ

- **What amount goes in Adjust charge?** The part you are **not** charging (the amount to deduct), not the amount you collect. The system posts it as negative revenue.
- **Why does a free service still need Adjust charge?** Because Start already posted the full revenue and Interrupt does not reverse it. Only Adjust charge actually removes that revenue.
- **Can't click Add payment / Adjust charge?** The branch has no open shift. Open one on **Sales Remittance** first.
- **Collected too much / need to refund?** Use **Add refund** on the Payments card (manager).
