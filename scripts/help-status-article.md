# Order & service status

Every sale in HHG-SPA moves through two small lifecycles that run side by side:

- **The order** — the whole bill (sales order)
- **Each service line** — one service for one guest

Knowing which state something is in answers three questions instantly: *can I still edit it*, *has the money been recognised yet*, and *does it earn commission*.

---

## 1. The order

An order only walks forward. It never steps back on its own — only a manager can reopen a finished one.

| Status | What it means | Editable? | Money |
|---|---|---|---|
| **Draft** | Being set up — guests and services are being added | ✅ Yes | The total is just an estimate; nothing is owed yet |
| **In service** | At least one service has started | ✅ Yes | Revenue begins posting to the folio |
| **Completed** | Every service is finished or cancelled | ❌ No | Final bill, waiting to be paid |
| **Paid** | The guest has paid in full at the counter | ❌ No | Cash is in; waiting for the daily Revenue Confirm |
| **Closed** | Locked by the daily Revenue Confirm | ❌ No | Revenue is booked. This is the end of the line. |
| **Cancelled** | The whole order was cancelled — all scheduled services are automatically cancelled | ❌ No | Zeroed out — nothing owed, nothing earned |

> The order turns **In service** automatically the moment you press **Start** on its first service, and turns **Completed** automatically once no service is still waiting or running.

---

## 2. Each service line

A single service for a single guest has its own short life:

```
Draft  →  In service  →  Service completed
  │
  └─ (service never delivered) ─→  Cancelled · No-show · Interrupted
```

### Draft
The starting point for every service. The desk can freely change the service, time, therapist, bed and discount. **A line stays in Draft whether or not a bed or therapist has been assigned** — assigning a bed doesn't change the status, it only reserves the bed.

### In service
You pressed **Start**. The clock is running and **the service's revenue is posted to the folio**. It is real money from here, so the line can no longer be re-priced casually.

> ⚠️ **Starting a service needs an open cash shift.** Pressing Start posts revenue, and that revenue needs a home — the open shift on the **Shift Cash Count** page (Reconciliation → Cash). If no shift is open for the branch, open one first, then Start.

### Service completed
You pressed **Finish**. The service was delivered and **the line is locked** — no more edits. This is the only state that **earns commission** for the therapist.

---

## 3. When a service doesn't happen

Three outcomes mean "this service was not delivered." They are kept as **separate states** because the reason matters for reporting — but they all behave the same way: **they free up the bed and the therapist for other guests, and they keep all of the line's data (service, time, who was assigned) untouched for the record.**

| Status | When it's used | Money |
|---|---|---|
| **Cancelled** | Called off *before* it started | Zero — nothing was ever posted |
| **No-show** | The guest never arrived | Zero — nothing was ever posted |
| **Interrupted** | Started, then stopped part-way | Whatever was already posted **stays on the folio** — adjust the charge by hand if a different amount or discount is due |

> Cancelled and No-show always happen *before* Start, so no revenue was ever posted — they are clean zeros. Interrupted happens *after* Start, so revenue is already on the folio; the system deliberately leaves it there and the desk settles the final amount manually.

---

## 4. The money, in one picture

Not every line counts as revenue. There are three layers:

| Line status | On the bill (expected) | Recognised revenue | Earns commission |
|---|:---:|:---:|:---:|
| Draft | ✅ | — | — |
| In service | ✅ | ✅ | — |
| Service completed | ✅ | ✅ | ✅ |
| Interrupted | ✅ (as settled) | ✅ | — |
| Cancelled | — | — | — |
| No-show | — | — | — |

- **On the bill** — what the guest is expected to owe. Draft lines are included so the cashier sees a running total early.
- **Recognised revenue** — money the business has actually earned. It begins when a service goes **In service**, which is exactly why that step needs an open cash shift.
- **Commission** — only **Service completed** services pay the therapist.

---

## Quick reference

- Press **Start** → line goes **In service**, revenue posts (needs an open shift).
- Press **Finish** → line goes **Service completed**: locked, earns commission.
- **Cancelled / No-show / Interrupted** → bed and therapist freed, the record is kept.
- **Draft = editable. Completed / Paid / Closed = locked.**