// Acumatica contract-based REST API client.
//
// Pattern adopted from sibling group projects (ST Center / ENGO):
// - User login passes credentials to Acumatica; Set-Cookie collected server-side
//   into httpOnly acu_session cookie.
// - Every GL post / query uses the calling user's own ERP session — clear
//   responsibility trail, no shared service account for user actions.
// - Service account exists for webhooks / automation when no user is online.
// - Session expiry → throws AcuSessionRequiredError → frontend prompts re-login.

const BASE_URL = process.env.ACUMATICA_BASE_URL;
// Acumatica's login accepts `tenant` (multi-tenant instance) and `company`
// (multi-company within a tenant). HHG's instance uses `tenant` — matching
// the ENGO sibling project. `company` is kept for backward compatibility if
// any deployment needs it instead. If both are set, both are sent.
const TENANT = process.env.ACUMATICA_TENANT;
const COMPANY = process.env.ACUMATICA_COMPANY;
const BRANCH = process.env.ACUMATICA_BRANCH;
const LEDGER_ID = process.env.ACUMATICA_LEDGER_ID ?? 'MGMT';
const API_VERSION = process.env.ACUMATICA_API_VERSION ?? '23.200.001';

function api(): string {
  if (!BASE_URL) throw new Error('ACUMATICA_BASE_URL is not set');
  return `${BASE_URL.replace(/\/$/, '')}/entity/Default/${API_VERSION}`;
}

export class AcuSessionRequiredError extends Error {
  code = 'ACU_SESSION_REQUIRED' as const;
  constructor(detail = 'ERP session expired, please log in again') {
    super(`ACU_SESSION_REQUIRED: ${detail}`);
    this.name = 'AcuSessionRequiredError';
  }
}

function ensureCookie(cookie: string | null | undefined): string {
  if (!cookie) throw new AcuSessionRequiredError();
  if (!BASE_URL) throw new Error('ACUMATICA_BASE_URL is not set');
  return cookie;
}

export type AcumaticaLoginResult =
  | { ok: true; userId: string; cookie: string }
  | { ok: false; error: string };

export async function acumaticaLogin(
  username: string,
  password: string,
): Promise<AcumaticaLoginResult> {
  if (!BASE_URL) {
    return { ok: false, error: 'ACUMATICA_BASE_URL is not set' };
  }

  const body: Record<string, string> = { name: username, password };
  if (TENANT) body.tenant = TENANT;
  if (COMPANY) body.company = COMPANY;
  if (BRANCH) body.branch = BRANCH;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL.replace(/\/$/, '')}/entity/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      error: `Cannot reach Acumatica: ${(e as Error).message}`,
    };
  }

  if (res.status === 204 || res.status === 200) {
    const setCookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [];
    const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    return { ok: true, userId: username, cookie };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'Invalid username or password' };
  }

  const errorBody = await res.text().catch(() => '');
  if (
    res.status === 500 &&
    /invalid\s+credentials|login\s+failed/i.test(errorBody)
  ) {
    return { ok: false, error: 'Invalid username or password' };
  }

  return {
    ok: false,
    error: `Acumatica error (${res.status}): ${errorBody.slice(0, 200) || '(empty)'}`,
  };
}

// Service account login for webhooks / automation flows (no user online).
// Reads ACUMATICA_SERVICE_USERNAME / PASSWORD from env, caches cookie for 5 min.
let cachedServiceCookie: { cookie: string; expiresAt: number } | null = null;
const SERVICE_COOKIE_TTL_MS = 5 * 60 * 1000;

export async function loginWithServiceAccount(): Promise<string> {
  const now = Date.now();
  if (cachedServiceCookie && cachedServiceCookie.expiresAt > now) {
    return cachedServiceCookie.cookie;
  }
  const username = process.env.ACUMATICA_SERVICE_USERNAME;
  const password = process.env.ACUMATICA_SERVICE_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'ACUMATICA_SERVICE_USERNAME / PASSWORD not set (service account)',
    );
  }
  const res = await acumaticaLogin(username, password);
  if (!res.ok) throw new Error(`Service account login failed: ${res.error}`);
  if (!res.cookie) throw new Error('Service account login OK but no cookie returned');
  cachedServiceCookie = {
    cookie: res.cookie,
    expiresAt: now + SERVICE_COOKIE_TTL_MS,
  };
  return res.cookie;
}

export async function acumaticaLogout(
  cookie: string | null | undefined,
): Promise<void> {
  if (!cookie || !BASE_URL) return;
  try {
    await fetch(`${BASE_URL.replace(/\/$/, '')}/entity/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
  } catch {
    /* logout failure shouldn't block — session expires naturally */
  }
}

// ---------------------------------------------------------------------------
// GL push (Journal Transaction) — Two-phase PUT
//   1) PUT body with Hold:true + Details[] → returns BatchNbr
//   2) PUT BatchNbr + Hold:false → releases the batch
// ---------------------------------------------------------------------------

export interface GLLine {
  account: string;
  sub_account: string;
  debit_amount: number | null;
  credit_amount: number | null;
  transaction_desc: string;
  // Optional: override BranchID for this line; falls back to entry.branch.
  branch?: string | null;
}

export interface GLPushResult {
  batchNbr: string | null;
  raw: unknown;
}

export async function pushGLEntry(
  entry: {
    date: string; // YYYY-MM-DD
    description: string;
    currency: string;
    branch: string;
    lines: GLLine[];
    hold?: boolean; // default false; useful for testing
  },
  userCookie: string | null | undefined,
): Promise<GLPushResult> {
  const cookie = ensureCookie(userCookie);
  const branch = entry.branch || BRANCH;
  if (!branch) throw new Error('GL push missing branch (ACUMATICA_BRANCH not set)');

  const body = {
    Module: { value: 'GL' },
    LedgerID: { value: LEDGER_ID },
    BranchID: { value: branch },
    CurrencyID: { value: entry.currency },
    Date: { value: entry.date },
    Description: { value: entry.description },
    Hold: { value: true },
    Details: entry.lines.map((l) => ({
      BranchID: { value: l.branch || branch },
      Account: { value: l.account },
      // Acumatica subaccount cannot contain dashes — strip before posting.
      Subaccount: { value: l.sub_account.replace(/-/g, '') },
      Project: { value: 'X' },
      DebitAmount: { value: l.debit_amount ?? 0 },
      CreditAmount: { value: l.credit_amount ?? 0 },
      TransactionDescription: { value: l.transaction_desc },
    })),
  };

  const res = await fetch(`${api()}/JournalTransaction?$expand=Details`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new AcuSessionRequiredError();
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GL push failed (${res.status}): ${text.slice(0, 1500)}`);
  }
  const created = (await res.json()) as { BatchNbr?: { value?: string } };
  const batchNbr = created?.BatchNbr?.value ?? null;

  // Phase 2: release hold → batch becomes posted
  if (!entry.hold && batchNbr) {
    const r2 = await fetch(`${api()}/JournalTransaction`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        Module: { value: 'GL' },
        BatchNbr: { value: batchNbr },
        Hold: { value: false },
      }),
    });
    if (r2.status === 401) throw new AcuSessionRequiredError();
    if (!r2.ok) {
      const text = await r2.text().catch(() => '');
      throw new Error(`GL release failed (${r2.status}): ${text.slice(0, 1500)}`);
    }
  }

  return { batchNbr, raw: created };
}

// ── AP Bill (tips → payroll, refunds, etc.) ──────────────────────────────────
// Pattern mirrors the sibling HHGeeeeeeee/ENGO repo's pushAPBill: two-phase PUT
// (Hold:true to insert + details → second PUT with ReferenceNbr + Hold:false to
// release) so the bill ends up as open AP (not stuck on hold).

export interface APLine {
  account: string;
  sub_account: string;
  quantity: number;
  unit_cost: number;
  amount: number;
  transaction_desc: string;
}

export interface APBillPushResult {
  refNbr: string | null;
  raw: unknown;
}

export async function pushAPBill(
  bill: {
    vendor: string;
    vendor_ref: string;
    date: string;
    description: string;
    financial_branch: string;
    cash_account: string;
    currency?: string;
    lines: APLine[];
  },
  userCookie: string | null | undefined,
): Promise<APBillPushResult> {
  const cookie = ensureCookie(userCookie);
  const body = {
    Type: { value: 'Bill' },
    CurrencyID: { value: bill.currency ?? 'PHP' },
    CashAccount: { value: bill.cash_account },
    Vendor: { value: bill.vendor },
    VendorRef: { value: bill.vendor_ref },
    Date: { value: bill.date },
    Description: { value: bill.description },
    BranchID: { value: bill.financial_branch },
    Hold: { value: true },
    Details: bill.lines.map((l) => ({
      BranchID: { value: bill.financial_branch },
      Account: { value: l.account },
      // Acumatica subaccount can't contain dashes — strip before posting.
      Subaccount: { value: l.sub_account.replace(/-/g, '') },
      Qty: { value: l.quantity },
      UnitCost: { value: l.unit_cost },
      Amount: { value: l.amount },
      TransactionDescription: { value: l.transaction_desc },
    })),
  };

  const res = await fetch(`${api()}/Bill?$expand=Details`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new AcuSessionRequiredError();
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AP Bill push failed (${res.status}): ${text.slice(0, 1500)}`);
  }
  const created = (await res.json()) as { ReferenceNbr?: { value?: string } };
  const refNbr = created?.ReferenceNbr?.value ?? null;

  // Phase 2: release the hold → the bill is open AP (vendor balance updated).
  if (refNbr) {
    const r2 = await fetch(`${api()}/Bill`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        Type: { value: 'Bill' },
        ReferenceNbr: { value: refNbr },
        Vendor: { value: bill.vendor },
        Hold: { value: false },
      }),
    });
    if (r2.status === 401) throw new AcuSessionRequiredError();
    if (!r2.ok) {
      const text = await r2.text().catch(() => '');
      throw new Error(`AP Bill release failed (${r2.status}): ${text.slice(0, 1500)}`);
    }
  }

  return { refNbr, raw: created };
}

/**
 * Attach a file to a posted AP Bill (e.g. the tip-settlement detail PDF).
 * Uses the same `/files/{filename}` PUT pattern as the journal attach.
 */
export async function attachFileToBill(
  opts: {
    refNbr?: string | null;
    guid?: string | null;
    filename: string;
    fileBuffer: ArrayBuffer;
    mimeType: string;
  },
  userCookie: string | null | undefined,
): Promise<true> {
  const cookie = ensureCookie(userCookie);
  const safeName = encodeURIComponent(opts.filename);
  let url: string;
  if (opts.refNbr) {
    url = `${api()}/Bill/Bill/${encodeURIComponent(opts.refNbr)}/files/${safeName}`;
  } else if (opts.guid) {
    url = `${api()}/Bill/${opts.guid}/files/${safeName}`;
  } else {
    throw new Error('attachFileToBill: refNbr or guid required');
  }
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': opts.mimeType || 'application/octet-stream', Accept: 'application/json' },
    body: opts.fileBuffer,
  });
  if (res.status === 401) throw new AcuSessionRequiredError();
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Attach file to bill failed (${res.status}): ${text.slice(0, 800)}`);
  }
  return true;
}

/**
 * Attach a file to an already-posted JournalTransaction (e.g. the AR collection
 * proof — remittance slip / cash photo). Acumatica file-attach pattern (per the
 * sibling ENGO/ST Center projects' AP Bill flow): PUT the file body to
 * `{entity}/{...keys}/files/{filename}` with Content-Type = mime, Cookie =
 * user's ERP session. The journal's natural keys are Module + BatchNbr, so the
 * URL is `/JournalTransaction/{Module}/{BatchNbr}/files/{filename}`.
 */
export async function attachFileToJournal(
  opts: {
    module?: string;
    batchNbr: string;
    filename: string;
    fileBuffer: ArrayBuffer;
    mimeType: string;
  },
  userCookie: string | null | undefined,
): Promise<true> {
  const cookie = ensureCookie(userCookie);
  const mod = opts.module ?? 'GL';
  const safeName = encodeURIComponent(opts.filename);
  const url = `${api()}/JournalTransaction/${encodeURIComponent(mod)}/${encodeURIComponent(opts.batchNbr)}/files/${safeName}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      'Content-Type': opts.mimeType || 'application/octet-stream',
      Accept: 'application/json',
    },
    body: opts.fileBuffer,
  });
  if (res.status === 401) throw new AcuSessionRequiredError();
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Attach file to journal failed (${res.status}): ${text.slice(0, 800)}`);
  }
  return true;
}
