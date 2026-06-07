# Charging for an interrupted service (full / partial / free)

## When revenue is recognised

Service revenue is recognised when the service **Finishes** — the full, discount-applied amount is posted to the folio **at finish**, not at start. So before finishing, the desk confirms the discount is right (the Finish prompt shows the exact amount that will be booked).

An **Interrupt** is a terminal end that never reaches Finish, so it books revenue from the **Handling** you pick:

- **Full charge** → books the full amount immediately (just like a finish).
- **No charge** → books nothing; requires a **manager PIN**.

> **Audit note.** A charged interrupt means the service was (partly) delivered and billed, so its revenue is recognised right then — automatically, and tied to that service line — exactly like a finish. It can't be forgotten, and the shift / GL always reflects delivered-and-charged work. A *waiver* (No charge) is gated by a manager PIN, so the decision **not** to recognise revenue is an approved, audited control rather than a silent omission.

**Prerequisite**: finishing — or a charged interrupt — posts revenue into the branch's **open shift**, and the service category needs a revenue transaction code. With either missing, the action is blocked with a hint (open a shift on Sales Remittance / set the code in Settings → Service Categories).

---

## The three cases

After interrupting (service row or board → **Interrupt** → Handling + Reason), handle the money in the order's **Folio** section.

### Case 1 — Full charge: just Add payment

Interrupt with **Full charge** → the full revenue is already booked.

1. Payments card → **Add payment**, collect the full amount.

### Case 2 — Partial charge: Adjust charge down, then Add payment

Interrupt with **Full charge** (books the full amount), then knock off the part you are not charging. Example: a ₱1,000 service where you only collect ₱600.

1. Revenue card → **Adjust charge** (manager PIN) — "Amount to deduct" = the part **not** charged (**₱400**). Posts a −₱400 revenue line.
2. Payments card → **Add payment** — the actual amount (**₱600**).

Net revenue = 1,000 − 400 = **₱600**, collected ₱600.

### Case 3 — Free: No charge, nothing else

Interrupt with **No charge** (manager PIN) → no revenue is booked. **Done** — no Adjust charge needed.

---

## Quick reference

| Case | Interrupt handling | Revenue booked by interrupt | Then on the order |
| --- | --- | --- | --- |
| Full charge | Full charge | full amount | Add payment (full) |
| Partial charge | Full charge | full amount | Adjust charge (deduct uncharged) + Add payment |
| Free | No charge (manager PIN) | none | nothing |

## FAQ

- **Why does interrupting book revenue automatically?** See the audit note above — delivered-and-charged work is recognised at the moment it happens and tied to the service line, so it can't be missed; a waiver needs manager approval.
- **A free interrupt — do I still Adjust charge?** No. No charge books nothing, so there is nothing to reverse.
- **Can't Interrupt (Full charge) / Finish?** The branch has no open shift, or the service category has no revenue transaction code. Open a shift on **Sales Remittance** / set the code in *Settings → Service Categories*.
- **Collected too much / need to refund?** Use **Add refund** on the Payments card (manager).
