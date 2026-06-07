# Report Builder

Build your own summary reports: pick a **date range**, choose **what to group by**, and HHG-SPA adds up the numbers for you. There are two reports, on two tabs:

- **Revenue** — money, grouped any way you like.
- **Occupancy** — how busy you were versus how busy you *could* have been.

The **date range** and **Branches** at the top apply to both tabs. Branches limits the report to the branches you select (you only ever see branches you're allowed to).

---

## 1. Revenue report

Every **service line** (one service for one guest) is one row of raw data. The report adds those rows up by whatever you tick — so a bill with 3 services counts as 3 lines.

### Group By

Tick any combination of dimensions. The small number on a ticked box is its **column order** (first tick = left-most column). Tick **nothing** and you get a single grand-total row.

| Dimension | What it groups by |
|---|---|
| **Date** | The service date |
| **Start Hour** | The booked start hour (0–23) |
| **Order Branch** | Where the bill was opened |
| **Station Branch** | Where the service was physically done (the bed/room's branch) |
| **Source** | Booking channel (walk-in, hotel, etc.) |
| **Category / Service** | The service category or the specific service |
| **Therapist** | Who delivered it |
| **Station** | The bed / room / chair |
| **Status** | The service line's status |
| **Duration** | Service length in minutes |

> **Order Branch vs Station Branch** are not always the same — a guest can book at one branch and be served at another (cross-branch). Commission follows the **station** branch.

### Status filter

The service line statuses you want to count. **Cancelled is unticked by default** so cancelled services don't inflate your sales. Tick more (or fewer) as needed.

### The figures

| Figure | Meaning |
|---|---|
| **Lines** | Number of service lines |
| **Sales** | List price before discount |
| **Discount** | Discount given |
| **Net** | What was actually charged (Sales − Discount) |
| **Commission** | Therapist commission on those lines |
| **Net of Comm.** | Net − Commission — what's left after paying commission |

> Turn on **Commission: settled lines only** to count commission only for lines that have already gone through a Commission Settlement. Sales / Net are unaffected — the toggle only changes the commission figure.

---

## 2. Occupancy report

This answers *"how busy were we, and how much money did that capacity earn?"* — utilization, occupancy and revenue against your available capacity.

Because these are **ratios** (busy hours ÷ available hours), they only make sense per **Date** and per **Station Branch** — there's no "available hours" for a single service or source, so those can't be grouped here.

### Group By

Pick **Date**, **Station Branch**, both, or neither:

- **Date only** — one row per day (all selected branches pooled).
- **Station Branch only** — one row per branch, summed over the whole range.
- **Both** — one row per branch per day.
- **Neither** — a single total for the range.

### The figures

| Figure | Meaning |
|---|---|
| **Utilization** | Delivered service hours ÷ capacity (the bottleneck of beds vs therapists) |
| **Station Occ** | How much of your bed-hours were occupied |
| **Therapist Occ** | How much of your rostered therapist-hours were occupied |
| **Capacity / Therapist / Actual hrs** | The underlying hours behind the ratios |
| **RevPATH** | **Rev**enue **P**er **A**vailable **T**herapist-**H**our — net revenue ÷ available therapist-hours. Your "yield" per hour of staff you paid for. |
| **Sales … Net of Comm.** | The same money figures as the Revenue report, for this group |

> Over a range, ratios are **summed numerator ÷ summed denominator** — never an average of daily percentages — so a busy long day counts more than a quiet short one, exactly as it should.

> If you select several branches that **don't share a therapist pool**, a pooled day can't be computed and the row shows a note instead of numbers. Group by **Station Branch** to see each branch on its own, which always computes.

---

## 3. Good to know

- A blank group value shows as **Unassigned** (e.g. a line with no therapist, or a service in an external room with no station).
- All money is the branch's currency; reports never round away the cents.
- Reports are read-only — generate as many as you like; nothing is changed.