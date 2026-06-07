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
| **In service** | At least one service has started | ✅ Yes | Service running — revenue books when it finishes |
| **Completed** | Every service is finished or cancelled, but the bill is not fully paid | ❌ No | Final bill — a balance is still due |
| **Closed** | Every service finished **and** the bill paid in full | ❌ No | Done — revenue booked, nothing owed. The end of the line. |
| **Cancelled** | The whole order was called off before any service was delivered | ❌ No | Zeroed out — nothing owed, nothing earned |

> The order turns **In service** automatically the moment you press **Start** on its first service, and turns **Completed** automatically once no service is still waiting or running. It turns **Closed** automatically once every service is finished **and** the bill is paid in full.

> ⚠️ **Cancelling an order** is only possible while **nothing has been delivered** — that is, **no line is In service and none is Service completed**. The moment a service starts (it's being delivered) or finishes (revenue recognised, commission earned), that money can't be wiped by a cancel, so the order can no longer be cancelled — correct it with a **refund / adjustment** instead. Cancelling cancels every remaining **Draft** line and excludes the whole order from all totals. (There is no separate "Void" — a cancelled order simply shows as **Cancelled**.)

---

## 2. Each service line

A single service for a single guest has its own short life:

```
Draft  →  In service  →  Service completed
  │            │
  │            └─ (stopped part-way) ──→  Interrupted
  │
  └─ (never started) ──→  Cancelled · No-show
```

### Draft
The starting point for every service. The desk can freely change the service, time, therapist, bed and discount. **A line stays in Draft whether or not a bed or therapist has been assigned** — assigning a bed doesn't change the status, it only reserves the bed.

### In service
You pressed **Start**. The clock is running. Revenue **isn't booked yet** — it's recognised when the service finishes (or on a charged interrupt). The line is being delivered, so it can no longer be re-priced casually.

### Service completed
You pressed **Finish**. The service was delivered, **its revenue is booked to the folio** at the final discount-applied amount, and **the line is locked** — no more edits. This is the only state that **earns commission** for the therapist.

> ⚠️ **Finishing a service needs an open cash shift.** Finishing recognises the revenue, and that revenue needs a home — the branch's open shift on the **Sales Remittance** page. If no shift is open for the branch, open one first, then Finish. (The service category also needs a revenue transaction code.)

---

## 3. When a service doesn't happen

Three outcomes mean "this service was not delivered." They are kept as **separate states** because the reason matters for reporting — but they all behave the same way: **they free up the bed and the therapist for other guests, and they keep all of the line's data (service, time, who was assigned) untouched for the record.**

| Status | When it's used | Money |
|---|---|---|
| **Cancelled** | Called off *before* it started | Zero — nothing was ever posted |
| **No-show** | The guest never arrived | Zero — nothing was ever posted |
| **Interrupted** | Started, then stopped part-way | Books revenue from the chosen handling — **Full charge** posts the full amount, **No charge** (manager PIN) posts nothing |

> Cancelled and No-show happen *before* any delivery, so they're clean zeros. Interrupted books revenue from its handling — Full charge posts the full amount, No charge (manager-approved) posts nothing — so the folio always matches what was actually charged. (See the *Charging for an interrupted service* article for the full / partial / free flow.)

---

## 4. The money, in one picture

Not every line counts as revenue. There are three layers:

| Line status | On the bill (expected) | Recognised revenue | Earns commission |
|---|:---:|:---:|:---:|
| Draft | ✅ | — | — |
| In service | ✅ | — | — |
| Service completed | ✅ | ✅ | ✅ |
| Interrupted | ✅ (as charged) | ✅ when charged | — |
| Cancelled | — | — | — |
| No-show | — | — | — |

- **On the bill** — what the guest is expected to owe. Draft lines are included so the cashier sees a running total early.
- **Recognised revenue** — money the business has actually earned. It's booked when a service **Finishes** (or on a charged interrupt), which is exactly why finishing needs an open cash shift.
- **Commission** — only **Service completed** services pay the therapist.

---

## Quick reference

- Press **Start** → line goes **In service**: the clock runs (no revenue booked yet).
- Press **Finish** → line goes **Service completed**: revenue books (needs an open shift), the line locks and earns commission. Confirm the discount first — the prompt shows the amount booked.
- **Cancelled / No-show / Interrupted** → bed and therapist freed, the record is kept.
- **Cancel an order** → only while no line is In service or Service completed; otherwise refund/adjust.
- **Draft = editable. Completed / Closed = locked.**

