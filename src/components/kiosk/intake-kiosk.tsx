'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SignaturePad } from '@/components/kiosk/signature-pad';
import {
  KIOSK_LOCALES,
  KIOSK_DICTS,
  HEALTH_KEYS,
  DEFAULT_LOCALE,
  type KioskLocale,
  type HealthKey,
} from '@/lib/i18n/kiosk';
import { submitIntake, exitKiosk } from '@/app/(kiosk)/kiosk/actions';

type Gender = 'male' | 'female' | 'other' | 'na';
type Pressure = 'soft' | 'medium' | 'hard';

const EMPTY_HEALTH: Record<HealthKey, boolean | null> = {
  pregnant: null,
  cardiac: null,
  injury: null,
  skin: null,
  allergy: null,
};

// Big touch-friendly segmented choice.
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-w-20 flex-1 rounded-xl border-2 px-4 py-3 text-base font-semibold transition ${
            value === o.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background hover:bg-accent'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function IntakeKiosk({ branchName, branchCode }: { branchName: string; branchCode: string }) {
  const router = useRouter();
  const [locale, setLocale] = useState<KioskLocale>(DEFAULT_LOCALE);
  const t = KIOSK_DICTS[locale];

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [serviceNote, setServiceNote] = useState('');
  const [pressure, setPressure] = useState<Pressure | null>(null);
  const [health, setHealth] = useState<Record<HealthKey, boolean | null>>(EMPTY_HEALTH);
  const [healthNote, setHealthNote] = useState('');
  const [agree, setAgree] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);

  const [submitting, startSubmit] = useTransition();
  const [done, setDone] = useState(false);

  // Exit-to-front-desk flow.
  const [exitOpen, setExitOpen] = useState(false);
  const [exitPass, setExitPass] = useState('');
  const [exiting, startExit] = useTransition();

  function reset() {
    setName('');
    setEmail('');
    setPhone('');
    setAge('');
    setGender(null);
    setServiceNote('');
    setPressure(null);
    setHealth(EMPTY_HEALTH);
    setHealthNote('');
    setAgree(false);
    setSignature(null);
    setLocale(DEFAULT_LOCALE);
    setDone(false);
  }

  function handleSubmit() {
    if (!name.trim()) return toast.error(t.errName);
    if (!pressure) return toast.error(t.errPressure);
    if (HEALTH_KEYS.some((k) => health[k] === null)) return toast.error(t.healthTitle);
    if (!signature) return toast.error(t.errSign);
    if (!agree) return toast.error(t.errAgree);

    const ageNum = age.trim() ? Number(age) : null;
    startSubmit(async () => {
      const res = await submitIntake({
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        age: ageNum != null && Number.isFinite(ageNum) ? Math.trunc(ageNum) : null,
        gender,
        serviceNote: serviceNote.trim() || null,
        pressure,
        health: Object.fromEntries(HEALTH_KEYS.map((k) => [k, health[k] === true])),
        healthNote: healthNote.trim() || null,
        language: locale,
        agree: true,
        signatureDataUrl: signature,
      });
      if (res.ok) setDone(true);
      else toast.error(res.error);
    });
  }

  function handleExit() {
    startExit(async () => {
      const res = await exitKiosk(exitPass);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
        <CheckCircle2 className="size-20 text-green-600" />
        <h1 className="text-3xl font-bold">{t.thankTitle}</h1>
        <p className="max-w-md text-lg font-medium text-muted-foreground">{t.thankMsg}</p>
        <Button size="lg" className="mt-2 h-14 px-10 text-lg" onClick={reset}>
          {t.next}
        </Button>
      </div>
    );
  }

  const yesNo = [
    { value: 'yes', label: t.yes },
    { value: 'no', label: t.no },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-2xl p-5 pb-24">
      {/* Header: branch + language switch + exit */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-muted-foreground">
          {branchName} <span className="font-mono">({branchCode})</span>
        </span>
        <button
          type="button"
          onClick={() => setExitOpen((o) => !o)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
        >
          <LogOut className="size-3.5" /> staff
        </button>
      </div>

      {exitOpen && (
        <div className="mb-4 flex items-end gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex-1">
            <Label className="text-xs font-semibold">Staff passcode to exit</Label>
            <Input
              type="password"
              value={exitPass}
              onChange={(e) => setExitPass(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button variant="outline" onClick={handleExit} disabled={exiting}>
            {exiting ? '…' : 'Exit'}
          </Button>
        </div>
      )}

      {/* Language switch */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {KIOSK_LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            className={`rounded-full border px-3 py-1 text-sm font-semibold transition ${
              locale === l ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent'
            }`}
          >
            {KIOSK_DICTS[l].nativeName}
          </button>
        ))}
      </div>

      <h1 className="text-2xl font-bold">{t.title}</h1>
      <p className="mb-6 mt-1 font-medium text-muted-foreground">{t.subtitle}</p>

      <div className="flex flex-col gap-6">
        {/* Identity */}
        <div className="flex flex-col gap-2">
          <Label className="text-base font-semibold">{t.name} *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-12 text-base" maxLength={120} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-base font-semibold">
              {t.email} <span className="text-xs font-medium text-muted-foreground">({t.optional})</span>
            </Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 text-base" maxLength={160} />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-base font-semibold">
              {t.phone} <span className="text-xs font-medium text-muted-foreground">({t.optional})</span>
            </Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-12 text-base" maxLength={40} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-base font-semibold">
              {t.age} <span className="text-xs font-medium text-muted-foreground">({t.optional})</span>
            </Label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={149}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="h-12 text-base"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-base font-semibold">
              {t.gender} <span className="text-xs font-medium text-muted-foreground">({t.optional})</span>
            </Label>
            <Segmented<Gender>
              value={gender}
              onChange={setGender}
              options={[
                { value: 'male', label: t.genderMale },
                { value: 'female', label: t.genderFemale },
                { value: 'other', label: t.genderOther },
                { value: 'na', label: t.genderNa },
              ]}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-base font-semibold">
            {t.service} <span className="text-xs font-medium text-muted-foreground">({t.optional})</span>
          </Label>
          <Input
            value={serviceNote}
            onChange={(e) => setServiceNote(e.target.value)}
            placeholder={t.servicePlaceholder}
            className="h-12 text-base"
            maxLength={500}
          />
        </div>

        {/* Pressure */}
        <div className="flex flex-col gap-2">
          <Label className="text-base font-semibold">{t.pressure} *</Label>
          <Segmented<Pressure>
            value={pressure}
            onChange={setPressure}
            options={[
              { value: 'soft', label: t.pressureSoft },
              { value: 'medium', label: t.pressureMedium },
              { value: 'hard', label: t.pressureHard },
            ]}
          />
        </div>

        {/* Health declaration */}
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <h2 className="text-lg font-bold">{t.healthTitle}</h2>
          {HEALTH_KEYS.map((k) => (
            <div key={k} className="flex flex-col gap-2 border-b border-border/60 pb-3 last:border-0 last:pb-0">
              <span className="text-base font-medium">{t.health[k]}</span>
              <Segmented
                value={health[k] === null ? null : health[k] ? 'yes' : 'no'}
                onChange={(v) => setHealth((p) => ({ ...p, [k]: v === 'yes' }))}
                options={yesNo as unknown as { value: string; label: string }[]}
              />
            </div>
          ))}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-semibold">{t.healthNote}</Label>
            <Textarea
              value={healthNote}
              onChange={(e) => setHealthNote(e.target.value)}
              placeholder={t.healthNotePlaceholder}
              rows={2}
              maxLength={1000}
            />
          </div>
        </div>

        {/* Consent */}
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <h2 className="text-lg font-bold">{t.consentTitle}</h2>
          <p className="text-sm font-medium leading-relaxed text-muted-foreground">{t.consentText}</p>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg p-1">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="mt-0.5 size-5 cursor-pointer accent-primary"
            />
            <span className="text-base font-semibold">{t.agree}</span>
          </label>
        </div>

        {/* Signature */}
        <div className="flex flex-col gap-2">
          <Label className="text-base font-semibold">{t.signatureTitle} *</Label>
          <SignaturePad onChange={setSignature} clearLabel={t.clear} hint={t.signatureHint} />
        </div>

        <Button
          size="lg"
          className="h-16 text-xl font-bold"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? t.submitting : t.submit}
        </Button>
      </div>
    </div>
  );
}
