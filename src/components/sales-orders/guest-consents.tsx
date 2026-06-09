'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FileText, FileSignature, Paperclip, Check, X, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  listUnboundConsents,
  getConsentDetail,
  bindConsent,
  unbindConsent,
  type ConsentSummary,
  type ConsentDetail,
} from '@/app/(dashboard)/sales-orders/consent-actions';
import { KIOSK_DICTS, HEALTH_KEYS } from '@/lib/i18n/kiosk';

// Staff-facing labels (fixed language) for values stored under stable keys.
const EN = KIOSK_DICTS.en;
const PRESSURE_LABEL: Record<string, string> = { soft: EN.pressureSoft, medium: EN.pressureMedium, hard: EN.pressureHard };
const GENDER_LABEL: Record<string, string> = { male: EN.genderMale, female: EN.genderFemale, other: EN.genderOther, na: EN.genderNa };

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export interface BoundConsentInfo {
  id: string;
  name: string;
  signed_at: string;
  language: string;
  pressure: string | null;
}

interface Guest {
  id: string;
  customer_name: string;
  seq_no: number;
}

export function GuestConsents({
  orderId,
  branchId,
  guests,
  bound,
}: {
  orderId: string;
  branchId: string;
  guests: Guest[];
  bound: Record<string, BoundConsentInfo>;
}) {
  const [attachFor, setAttachFor] = useState<Guest | null>(null);
  const [pool, setPool] = useState<ConsentSummary[] | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConsentDetail | null>(null);
  const [pending, startTransition] = useTransition();

  function openAttach(g: Guest) {
    setAttachFor(g);
    setPool(null);
    startTransition(async () => setPool(await listUnboundConsents(branchId)));
  }

  function openView(consentId: string) {
    setViewId(consentId);
    setDetail(null);
    startTransition(async () => setDetail(await getConsentDetail(consentId)));
  }

  function doBind(consentId: string) {
    if (!attachFor) return;
    const guestId = attachFor.id;
    startTransition(async () => {
      const res = await bindConsent(consentId, orderId, guestId);
      if (res.ok) {
        toast.success('Consent attached');
        setAttachFor(null);
      } else {
        toast.error(res.error);
      }
    });
  }

  function doUnbind(consentId: string) {
    startTransition(async () => {
      const res = await unbindConsent(consentId);
      if (res.ok) toast.success('Consent detached');
      else toast.error(res.error);
    });
  }

  return (
    <>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {guests.map((g) => {
          const b = bound[g.id];
          return (
            <div key={g.id} className="flex items-center gap-3 px-3 py-2.5">
              <FileSignature className={`size-4 shrink-0 ${b ? 'text-green-600' : 'text-muted-foreground'}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  <span className="font-mono text-muted-foreground">#{g.seq_no}</span> {g.customer_name}
                </p>
                {b ? (
                  <p className="truncate text-xs font-medium text-muted-foreground">
                    Signed {fmt(b.signed_at)} · {KIOSK_DICTS[b.language as keyof typeof KIOSK_DICTS]?.nativeName ?? b.language}
                    {b.pressure ? ` · ${PRESSURE_LABEL[b.pressure] ?? b.pressure}` : ''}
                    {b.name && b.name !== g.customer_name ? ` · form: ${b.name}` : ''}
                  </p>
                ) : (
                  <p className="text-xs font-medium text-muted-foreground">No consent attached</p>
                )}
              </div>
              {b ? (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => openView(b.id)}>
                    <FileText className="size-3.5" /> View
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => doUnbind(b.id)} disabled={pending}>
                    <X className="size-3.5" /> Detach
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => openAttach(g)} disabled={pending}>
                  <Paperclip className="size-3.5" /> Attach
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Attach: pick from the branch's pending pool */}
      <Dialog open={!!attachFor} onOpenChange={(o) => !o && setAttachFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-bold">
              Attach consent to {attachFor ? `#${attachFor.seq_no} ${attachFor.customer_name}` : ''}
            </DialogTitle>
            <DialogDescription className="font-medium">
              Unsigned forms from this branch (last 2 days). Pick the one this guest filled in.
            </DialogDescription>
          </DialogHeader>

          {pool === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : pool.length === 0 ? (
            <p className="py-10 text-center text-sm font-medium text-muted-foreground">
              No pending forms for this branch. Ask the guest to fill in the tablet first.
            </p>
          ) : (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {pool.map((c) => {
                const flagged = HEALTH_KEYS.filter((k) => c.health[k]);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => doBind(c.id)}
                    disabled={pending}
                    className="flex flex-col gap-1 rounded-lg border border-border p-3 text-left transition hover:border-primary hover:bg-accent disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{c.name}</span>
                      <span className="text-xs font-medium text-muted-foreground">{fmt(c.signed_at)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-xs font-medium text-muted-foreground">
                      {c.age != null && <span>Age {c.age}</span>}
                      {c.gender && <span>{GENDER_LABEL[c.gender] ?? c.gender}</span>}
                      {c.pressure && <span>Pressure: {PRESSURE_LABEL[c.pressure] ?? c.pressure}</span>}
                      <span>{KIOSK_DICTS[c.language as keyof typeof KIOSK_DICTS]?.nativeName ?? c.language}</span>
                    </div>
                    {c.service_note && <p className="text-xs font-medium">“{c.service_note}”</p>}
                    {flagged.length > 0 && (
                      <p className="text-xs font-semibold text-amber-600">
                        ⚠ {flagged.length} health flag{flagged.length > 1 ? 's' : ''}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View a bound consent */}
      <Dialog open={!!viewId} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-bold">Consent form</DialogTitle>
          </DialogHeader>
          {detail === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : (
            <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <Field label="Name" value={detail.name} />
                <Field label="Signed" value={fmt(detail.signed_at)} />
                {detail.age != null && <Field label="Age" value={String(detail.age)} />}
                {detail.gender && <Field label="Gender" value={GENDER_LABEL[detail.gender] ?? detail.gender} />}
                {detail.phone && <Field label="Phone" value={detail.phone} />}
                {detail.email && <Field label="Email" value={detail.email} />}
                {detail.nationality && <Field label="Nationality" value={detail.nationality} />}
                {detail.hotel && <Field label="Hotel" value={detail.hotel} />}
                {detail.pressure && <Field label="Pressure" value={PRESSURE_LABEL[detail.pressure] ?? detail.pressure} />}
                <Field label="Language" value={KIOSK_DICTS[detail.language as keyof typeof KIOSK_DICTS]?.nativeName ?? detail.language} />
              </div>

              {detail.service_note && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Focus areas</p>
                  <p className="font-medium">{detail.service_note}</p>
                </div>
              )}

              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{EN.healthTitle}</p>
                <ul className="flex flex-col gap-1">
                  {HEALTH_KEYS.map((k) => (
                    <li key={k} className="flex items-center justify-between gap-2">
                      <span className="font-medium">{EN.health[k]}</span>
                      <span className={`font-bold ${detail.health[k] ? 'text-amber-600' : 'text-muted-foreground'}`}>
                        {detail.health[k] ? EN.yes : EN.no}
                      </span>
                    </li>
                  ))}
                </ul>
                {detail.health_note && (
                  <p className="mt-2 rounded-md bg-muted p-2 text-xs font-medium">{detail.health_note}</p>
                )}
              </div>

              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {EN.consentTitle} <span className="font-mono normal-case">({detail.template_version})</span>
                </p>
                <p className="text-xs font-medium leading-relaxed text-muted-foreground">{detail.consent_text}</p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-green-600">
                  <Check className="size-3.5" /> Agreed
                </p>
              </div>

              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{EN.signatureTitle}</p>
                {detail.signature_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={detail.signature_url} alt="signature" className="h-32 rounded-md border border-border bg-white object-contain" />
                ) : (
                  <p className="text-xs font-medium text-muted-foreground">Signature unavailable</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
