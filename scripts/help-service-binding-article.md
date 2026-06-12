# How services, therapists & stations connect

When you add a service for a guest, the therapist list does **not** show everyone — and the station list does not show every bed. Three bindings decide who and what is offered:

```
Guest picks a service  +  preferred therapist gender
        │
        ├─ the service's Service Group  ──→  therapist must be TRAINED for it
        ├─ the guest's gender preference ──→  therapist's gender must MATCH
        └─ the service's Station Types   ──→  the bed/station must be one of them
```

If a therapist or bed is missing from a picker, one of these three rules filtered it out. This article explains each rule and **where it is configured**.

---

## 1. Service → therapist (training)

Every service item carries a **Service Group** — a skill tag like *Signature Massage* or *Gel Manicure* (all durations of the same service share one group).

Each therapist has a list of groups they can perform, set on their employee record. When you pick a service for a guest:

- The therapist picker only lists people **trained for that service's group**.
- **Auto-assign** respects the same rule — it never hands a hair service to a massage-only therapist.
- The rule also applies to **visiting** therapists (on a cross-branch shift here) and **borrowed** ones (from the sharing group). Auto-assign prefers this branch's own therapists first, then visiting, then borrowed.

> A service with no group set is unrestricted — anyone can take it.

---

## 2. Guest's preferred gender → therapist

Each **guest on the order** can have a preferred therapist gender: **Any · Male · Female**. It is set in the guest's header row on the order page and applies to **all of that guest's service lines**.

- The therapist picker and auto-assign only offer matching therapists. *Any* (the default) means no filtering.
- Changing the preference re-filters the list immediately.
- **Start is a hard stop**: even if a non-matching therapist was somehow assigned earlier (e.g. the preference changed after assigning), pressing **Start** is blocked with *"This therapist does not match the guest's gender preference"*. Fix the assignment or the preference first.

> A booking made through Reservations carries the guest's gender preference onto the order automatically.

---

## 3. Service → station type

Physical stations (Settings → **Service Stations**) each have a **type**: Massage Bed, Rest Room, Hair Chair, Nail Station, Steam Room, Hairwash Bed, Facial Bed, Chair.

Which types a service may use is decided in two layers:

1. **The service item's own "Station Types"** (Settings → Service Items Price) — the authoritative rule. A service may allow several types, e.g. nail work at a *Nail Station* **or** a *Chair*.
2. If the service item pins **no** types, the **service category's** "Station Types" (Settings → Service Categories) applies instead.

In practice:

- The station picker and auto-assign only offer beds of an allowed type.
- **Start re-checks it**: a mismatched bed blocks Start with *"… can't be used for this service (requires …)"* — this catches lines where the service was swapped after a bed was already pinned.
- A service that names station types **must have a station assigned** before it can start; a commission-earning service **must have a therapist assigned**. (A rest-room style line may need neither.)

The **category-level** station types also drive Reservations: the *next-available* calculation counts beds of that type at the branch, so a category pointing at the wrong type will under- or over-promise capacity.

---

## 4. Reservations use the same three rules

When Reservations computes **next available** for a request, it requires, for the whole party size:

- enough **stations of the needed type** at the branch, and
- enough **on-shift therapists** who match the **gender preference** and are **trained** for the chosen service (or for at least one service in the chosen category, when only a category was picked).

If either pool is too small, the slot moves later — or shows none today.

---

## Where each piece is configured

| What | Where |
|---|---|
| Service's group & station types | Settings → **Service Items Price** → edit the service |
| Category's station types | Settings → **Service Categories** → edit the category |
| Station's type | Settings → **Service Stations** → edit the station |
| Therapist's trained groups | Settings → **Employees** → edit → *Service Groups* |
| Therapist's gender | Settings → **Employees** → edit |
| Guest's preferred gender | On the order — the guest's header row (Any / Male / Female) |

---

## "Why is the list empty?" checklist

When no therapist (or no station) shows up:

1. **Training** — is anyone on shift trained for this service's group? (Employees → Service Groups)
2. **Gender** — does the guest's preference leave anyone? Try *Any* to confirm.
3. **Shift & busy** — therapists off shift, mid-service, booked at that time, or absent are listed but greyed with a reason (*off shift*, *busy · free ~14:30*…). They can still be picked as a deliberate override — but Start will re-check the gender and station rules.
4. **Station type** — does this branch actually have stations of the type the service requires? (Service Stations)
