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

/** Inline per-guest consent status + attach/view/detach actions.
 *  Renders compactly to sit in the guest card header row. */
export function GuestConsentInline({
  orderId,
  branchId,
  guestId,
  guestName,
  guestSeqNo,
  bound,
}: {
  orderId: string;
  branchId: string;
  guestId: string;
  guestName: string;
  guestSeqNo: number;
  bound: BoundConsentInfo | null;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [pool, setPool] = useState<ConsentSummary[] | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConsentDetail | null>(null);
  const [pending, startTransition] = useTransition();

  function openAttach() {
    setAttachOpen(true);
    setPool(null);
    startTransition(async () => setPool(await listUnboundConsents(branchId)));
  }

  function openView(consentId: string) {
    setViewId(consentId);
    setDetail(null);
    startTransition(async () => setDetail(await getConsentDetail(consentId)));
  }

  function doBind(consentId: string) {
    startTransition(async () => {
      const res = await bindConsent(consentId, orderId, guestId);
      if (res.ok) {
        toast.success('Consent attached');
        setAttachOpen(false);
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
      <div className="flex items-center gap-1.5">
        <FileSignature className={`size-3.5 shrink-0 ${bound ? 'text-green-600' : 'text-muted-foreground'}`} />
        {bound ? (
          <>
            <span className="text-xs font-medium text-muted-foreground truncate max-w-48">
              Signed {fmt(bound.signed_at)}
              {bound.pressure ? ` · ${PRESSURE_LABEL[bound.pressure] ?? bound.pressure}` : ''}
            </span>
            <Button variant="outline" size="icon-sm" onClick={() => openView(bound.id)} title="View consent">
              <FileText className="size-3" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => doUnbind(bound.id)} disabled={pending} title="Detach consent">
              <X className="size-3" />
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={openAttach} disabled={pending}>
            <Paperclip className="size-3" /> Attach consent
          </Button>
        )}
      </div>

      {/* Attach: pick from the branch's pending pool */}
      <Dialog open={attachOpen} onOpenChange={(o) => !o && setAttachOpen(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-bold">
              Attach consent to #{guestSeqNo} {guestName}
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
                    {c.service_note && <p className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-800">&quot;{c.service_note}&quot;</p>}
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
                <div className="rounded-md bg-orange-100 p-2.5">
                  <p className="text-xs font-bold uppercase tracking-wide text-orange-700">Focus areas</p>
                  <p className="font-semibold text-orange-900">{detail.service_note}</p>
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
                  <p className="mt-2 rounded-md bg-orange-100 p-2 text-xs font-semibold text-orange-900">{detail.health_note}</p>
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