-- Seed in-app Help articles: step-by-step operating guides + role cheat sheets.
-- Written for staff & manager training. Idempotent: re-running updates content
-- in place (matched on slug). Markdown is dollar-quoted ($md$) so apostrophes
-- need no escaping. applies_to_roles is metadata (roles: admin/manager/staff/
-- external_booker); the Help browser shows all published articles regardless.

-- ============================================================
-- GETTING STARTED
-- ============================================================

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('getting-started-login-navigation', 'Logging In & Getting Around', 'getting_started', $md$
Welcome to HHG-SPA POS. This is the front desk system for taking orders, running services, collecting payment, and closing the till. Start here.

## Sign in

1. Open the POS web address in your browser. The **Sign in** screen appears.
2. Type your **Username** and **Password** (the login IT gave you).
3. Click **Sign in**. You land on the **Dashboard**.

> Lost or want to change your password? Use **Change Password** at the very bottom of the left-hand menu.

## The layout

- **Left sidebar** — the main menu (your shortcuts to every screen).
- **Top bar** — the branch you are working in, plus page-specific buttons.
- **Main area** — whatever screen you opened.

## What each menu item does

| Menu | What it is for |
| --- | --- |
| **Dashboard** | Today at a glance |
| **Calendar** | The live day board — you create orders here |
| **Sales Remittance** | Open and close your shift, count cash |
| **Shift Schedule** | The weekly therapist roster |
| **Customers** | Customer records and stored-value cards (manager) |
| **Reconciliation** | Tips, commission, accounts receivable (manager) |
| **Report Builder** | Revenue and occupancy reports (manager) |
| **System Compare** | Cross-system checking (manager) |
| **Incidents** | Log an incident |
| **Help** | This documentation |
| **Settings** | Master data and system setup (manager / admin) |

Some items only appear for managers or admins — if you do not see one, your role does not use it.

## Sign out

Use **Sign Out** at the bottom of the menu when you are done. Do not bookmark the sign-out link — always click the button.
$md$, 0, true, ARRAY['admin','manager','staff','external_booker'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('getting-started-roles', 'Roles & What You Can See', 'getting_started', $md$
The system has four roles. Your role decides which menus and buttons you see.

## The four roles

| Role | What they can do |
| --- | --- |
| **Admin** | Everything, including system settings, roles & permissions, and the audit log |
| **Manager** | Daily operations, plus back-office settlement (tips, commission, AR), reports, and most settings |
| **Staff** | Daily operations and shift cash — taking orders, running services, collecting payment, counting the till. No back-office settlement or settings |
| **External booker** | Online booking only |

## Why a button might be missing

If a teammate can see a screen and you cannot, it is almost always a role difference — not a bug. Managers, for example, see **Reconciliation** and **Settings**; staff do not.

> Need access you do not have? Ask your manager — they manage users under **Settings → Users**.
$md$, 1, true, ARRAY['admin','manager','staff','external_booker'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

-- ============================================================
-- DAILY OPS (staff core, in daily order)
-- ============================================================

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('staff-open-shift', '1. Open Your Shift', 'daily_ops', $md$
**Do this first, every day.** Every sale and every payment must land inside an open shift. If no shift is open, you cannot take payment.

## Steps

1. In the left menu, click **Sales Remittance**.
2. Click **Open shift** (top right).
3. In the **Open a shift** dialog:
   - **Branch** — pick your branch (only shown if you work more than one).
   - **Shift** — pick the shift you are starting (e.g. Morning Shift).
4. Click **Open shift**. You will see a confirmation, e.g. *"Morning Shift opened"*, and it appears in the list.

## Good to know

- **Opening float (handover):** the system carries over the previous shift's closing cash count automatically. The very first shift of the day starts at 0.
- **Auto-recovery:** if the first shift of the day finds services that were never finished yesterday, it may show *"Auto-recovered N unfinished service(s) from a prior day"*. If it cannot recover one (no price set), it warns you to handle those orders by hand.

## If it will not open

- *"The business day is closed for this branch"* — the day was closed; a manager must reopen it.
- *"Shift is still open — close it first"* — that shift is already open.
- *"This shift is already closed for the day"* — it was already run today.
$md$, 1, true, ARRAY['admin','manager','staff'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('staff-create-order', '2. Create an Order (Walk-in or Booking)', 'daily_ops', $md$
You create orders from the **Calendar** — both for walk-ins and for booked guests.

## Steps

1. In the left menu, click **Calendar**.
2. Click **Create Order** on the toolbar.
   - *Tip:* you can instead click an empty slot on the board to pre-assign that bed/therapist to the first guest.
3. Fill in the order header:
   - **Branch** *(required)*
   - **Source** — defaults to Walk-in; change it if the guest came from another source.
   - **Date** *(required)* — defaults to today.
   - **Time** — defaults to the next quarter-hour. You may leave it blank if the time is not fixed yet.
4. Fill in each guest:
   - **Name** *(required)* and **Phone** *(required)*
   - **Gender** — Any / Male / Female (optional)
   - **Category** *(required)* — the service category
   - **Service** — pick the exact service, or leave it as **Decide later**
   - **Duration** — locked by the service if you picked one; otherwise choose 60 / 90 / 120 min
5. Click **Add guest** to put more guests on the same order.
6. Click **Create order**. The order opens, ready to run.

## If it will not submit

You will be told exactly what is missing — for example *"Enter a name for every guest"*, *"Enter a phone for every guest"*, or *"Pick a service category for every guest"*.
$md$, 2, true, ARRAY['admin','manager','staff'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('staff-run-service', '3. Run the Service: Start to Finish', 'daily_ops', $md$
An order moves through four states. The most important moment is **Finish** — that is when revenue is booked.

## The four states

| State | Meaning |
| --- | --- |
| **Draft** | Order created, nothing started yet |
| **In service** | At least one service is running. Revenue not booked yet |
| **Completed** | All services done, order waiting for payment |
| **Paid** | Fully paid and closed |

## Running one service line

1. Open the order. Each guest's service appears as a row.
2. Make sure the row has a **therapist** and a **station/bed** assigned — the **Start** button only appears once it is ready.
3. Click **Start**. This stamps the start time and moves the order to **In service**.
4. When the service is done, click **Finish**. A confirmation shows:
   - List price, any discount, and **Revenue to book**.
   - If you finish early, it warns you (e.g. *"Finishing early — only 35 of 60 min run"*).
5. Click **Finish & book ₱___**. **Revenue posts now.**

Other row actions when needed: **Interrupt** (stop part-way), **Cancel** (skip a draft line), **No-show** (guest did not arrive).

## Closing the order

When every service is finished, cancelled, or skipped, click **Complete** in the order header. If the order is already paid in full, it jumps straight to **Paid**.

> **Do not forget to press Finish.** It is the revenue moment. A service left running never posts its revenue — it only gets auto-recovered when the next day's first shift opens.
$md$, 3, true, ARRAY['admin','manager','staff'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('staff-take-payment', '4. Take Payment & Close the Order', 'daily_ops', $md$
Collect payment on the order's **Folio** tab. You must have a shift open first.

## Steps

1. Open the order and go to the **Folio** tab → **Payments & refunds**.
2. Click **Add payment**.
3. Choose:
   - **Branch**
   - **Method** — Cash, PAYMAYA, Stored Value, or AR (charge to account)
   - If **AR**: also pick **Bill to** and **Guest** (no cash is collected at the counter).
   - If **Stored Value**: pick the guest's **Stored value card**.
4. Check the **Open shift** line shows your shift. If it warns *"No open shift for this branch"*, open a shift first.
5. Enter the **Amount** (it defaults to the amount due; you cannot exceed it) and an optional **Reference** (receipt or transaction no.).
6. Click **Record**. You will see *"Payment recorded"*.

When the order is paid in full, it closes automatically to **Paid**.

## Refunds

Use **Add refund** in the same card to reverse a payment.
$md$, 4, true, ARRAY['admin','manager','staff'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('staff-close-shift', '5. Close Your Shift (Cash Count & Remittance)', 'daily_ops', $md$
At the end of your shift you count the drawer and hand over. The system blocks closing while money is still owed.

## Steps

1. Left menu → **Sales Remittance**, then open your shift.
2. Clear any **red blocker cards** at the top:
   - **Cancelled order(s) with a balance** — must be settled or refunded. *Blocks closing.*
   - **Completed order(s) with a balance** — must be collected. *Blocks closing.*
   - Yellow/advisory cards (e.g. *"unsettled orders not in service"*, *"services still running past planned end"*) do not block, but handle them.
3. Count the cash drawer and type the total into the **Cash** row's count field.
4. If your count does not match **Expected**, a **Variance reason** box appears — explain the difference (required).
5. *(Optional)* attach drawer photos or card/PAYMAYA settlement slips using **Proof** on each method row.
6. Click **Count & close ___** (e.g. *"Count & close Morning Shift"*).

The shift is now closed and the remittance is recorded. Non-cash methods balance automatically; only cash is physically counted.

> Need to reopen a closed shift (e.g. cash came in late)? That is **manager-only** and needs a reason.
$md$, 5, true, ARRAY['admin','manager','staff'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('staff-cheat-sheet', 'Staff Cheat Sheet (One Page)', 'daily_ops', $md$
Keep this open at the desk. The whole day on one page — each step links to its full guide.

## The 5 daily steps

1. **Open your shift** — Sales Remittance → **Open shift** → pick branch & shift. *(No open shift = you cannot take payment.)* → [Full guide](#help/staff-open-shift)
2. **Create an order** — Calendar → **Create Order** → fill guest(s) → **Create order**. → [Full guide](#help/staff-create-order)
3. **Run the service** — assign **therapist + bed** → **Start** → **Finish & book ₱___**. *(Revenue posts at Finish.)* → [Full guide](#help/staff-run-service)
4. **Take payment** — the order's **Folio** tab → **Add payment** → **Record**. Order closes to **Paid**. → [Full guide](#help/staff-take-payment)
5. **Close your shift** — Sales Remittance → count cash → **Count & close ___**. → [Full guide](#help/staff-close-shift)

## Order states

**Draft → In service → Completed → Paid**

## Key buttons

| You want to… | Button |
| --- | --- |
| Begin a service | **Start** |
| End a service (books revenue) | **Finish** → **Finish & book ₱___** |
| Stop a service part-way | **Interrupt** |
| Guest didn't arrive | **No-show** |
| Mark the whole order done | **Complete** |
| Collect money | **Add payment** → **Record** |
| Reverse a payment | **Add refund** |
| Close the till | **Count & close ___** |

## Remember

- No open shift = you cannot take payment. Open one first.
- **Finish** is the revenue moment — never leave a service running.
- You cannot close your shift while an order still owes money.
- Cash is counted; cards/PAYMAYA balance themselves.
$md$, 0, true, ARRAY['staff'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

-- ============================================================
-- RECONCILIATION (manager back-office)
-- ============================================================

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('mgr-tip-settlement', 'Tip Settlement', 'reconciliation', $md$
Settle PAYMAYA tips, grouped by therapist, into a payout. Usually done semi-monthly (1–15 and 16–end of month).

## Settle tips

1. **Reconciliation → Tip Settlement.**
2. Pick the **branch** chip at the top.
3. Set the range — **From** and **To** (defaults to the current half-month).
4. Review the per-therapist cards (date, order no., amount). A *"from XXX"* badge means a therapist on loan from another branch.
5. Tick the therapists to pay, or use **Select All**. The bar shows the running total.
6. Click **Settle Selected (X)**. The tips are settled and a settlement number is created; the view switches to **History**.

## History tab

- Filter by **Date From / Date To / Status** (default *Active*); use **Reset to this month** to clear.
- Tick rows and click **Download PDF (X)** (one PDF, or a ZIP for several).
- **Void** reverses a settlement — its tips go back to the open pool.
- **Retry** re-posts a settlement whose ERP posting failed.
$md$, 0, true, ARRAY['admin','manager'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('mgr-commission-settlement', 'Commission Settlement', 'reconciliation', $md$
Settle therapist commission for a period and export it to payroll. Usually semi-monthly.

## Settle commission

1. **Reconciliation → Commission Settlement.**
2. Pick the **branch** from the top bar.
3. Set **From** / **To** (defaults to the current half-month).
4. Review each therapist's card — sessions, net, and **commission** total, with per-session detail (date, order, station, service, minutes, rate %).
5. Tick therapists, or **Select All**, then click **Settle Selected (X)**. The view switches to **History**.

## History tab

- Filter by **Date From / Date To / Status**.
- **Adjust** a therapist's commission when there is an exception: enter an amount (can be negative) and a **required reason**; the trail is kept. Click **Save adjustment**.
- Export with **Payroll Excel (X)** (for HR) or **Download PDF (X)**.
- **Void** returns the period's entries to the open pool.

> Commission is handled in payroll, not the ERP — there is no ERP posting step here.
$md$, 1, true, ARRAY['admin','manager'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('mgr-accounts-receivable', 'Accounts Receivable (SOA)', 'reconciliation', $md$
Bill charged accounts (hotel guests / intercompany), then collect. Two tabs: **AR Balance** (collect) and **Generate SOA** (create statements).

## AR Balance — see and collect

1. **Reconciliation → Accounts Receivable.**
2. The headline splits outstanding into **Current** and **Overdue**, grouped by debtor.
3. Expand a debtor, then a statement. An amber banner like *"N closed orders · ₱X not yet on a statement"* means you should generate an SOA for them.
4. To collect on an issued/partly-paid statement, click **Settle**:
   - **Method** — Cash or Bank deposit
   - **Reference** — slip / transaction no.
   - **Proof** — image or PDF (max 10 MB)
   - Click **Settle**.
5. **Unsettle** reverses a settled statement.

## Generate SOA — create statements

1. Open the **Generate SOA** tab.
2. Set **From** / **To**.
3. Review the billing × branch groups (booking count and total). Statements never mix billing accounts or branches.
4. Tick the ones to bill, or **Select All**, then click **Generate SOA (X)**.

## SOA History

Filter by **Date / Status**, **Download PDF (X)**, and **Void** an issued statement to release its lines back to Generate.
$md$, 2, true, ARRAY['admin','manager'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('mgr-report-builder', 'Report Builder', 'reconciliation', $md$
Build revenue and occupancy summaries with free grouping. Two report types share the same date range and branch picker.

## Shared controls

- **From / To** — the date range (defaults to month start → today).
- **Branch** buttons — toggle the branches to include. Pick none to include all you have access to.

## Revenue report

1. Tick the **Group By** dimensions you want, in the order you want the columns: Date, Start Hour, Order Branch, Station Branch, Source, Category, Service, Therapist, Station, Status, Duration. (Pick none for a single grand-total row.)
2. Set the **Status filter** (defaults to In Service, Completed, Interrupted).
3. Optionally turn on **Commission: settled lines only**.
4. Click **Generate Report**.

Measures shown: **Lines, Sales, Discount, Net, Commission, Net of Comm.** — with a grand-total row.

## Occupancy report

1. Group by **Date** and/or **Station Branch** (only these have capacity denominators).
2. Click **Generate Report**.

Metrics include Utilization %, Station/Therapist Occupancy %, capacity vs actual hours, and **RevPATH** (net ÷ available therapist-hour).

> To export, copy the on-screen table — the report renders as a table in the page.
$md$, 3, true, ARRAY['admin','manager'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();

INSERT INTO public.help_articles (slug, title, category, content_markdown, order_index, is_published, applies_to_roles)
VALUES ('mgr-cheat-sheet', 'Manager Cheat Sheet (One Page)', 'reconciliation', $md$
Back-office rhythm on one page. (Managers can also do everything on the **Staff Cheat Sheet**.)

## Cadence

| When | Do |
| --- | --- |
| Each shift | Make sure staff **open** and **close** shifts; clear blocked closes |
| Semi-monthly (1–15, 16–EOM) | **Tip Settlement** and **Commission Settlement** |
| Per account terms | **Generate SOA** and collect **Accounts Receivable** |
| Any time | **Report Builder** for revenue / occupancy |

## Settlement quick steps

- **Tips:** Reconciliation → Tip Settlement → branch → set range → tick / **Select All** → **Settle Selected (X)** → **Download PDF**.
- **Commission:** Reconciliation → Commission Settlement → branch → range → **Settle Selected (X)** → **Payroll Excel** / **PDF**. Use **Adjust** (+reason) for exceptions.
- **AR:** Generate SOA → range → **Generate SOA (X)**; then AR Balance → **Settle** (method, reference, proof).

## Manager-only powers

- **Reopen** a closed shift (needs a reason).
- **Void** / **Unsettle** a settlement or statement.
- **Retry** a failed ERP posting.
- Manage users under **Settings → Users**.

## Watch for

- Blocked shift closes mean money is still owed — chase the order, do not bypass it.
- Settle tips & commission for the **whole** half-month before exporting payroll.
- Generate an SOA before an account ages into overdue.
$md$, 9, true, ARRAY['admin','manager'])
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title, category = EXCLUDED.category, content_markdown = EXCLUDED.content_markdown,
  order_index = EXCLUDED.order_index, is_published = EXCLUDED.is_published,
  applies_to_roles = EXCLUDED.applies_to_roles, updated_at = now();
