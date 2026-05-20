'use client';

import { useState, useTransition } from 'react';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { reportIncident } from '@/app/(dashboard)/incidents/actions';

const TYPES = [
  { value: 'complaint', label: 'Complaint' },
  { value: 'service_quality', label: 'Service quality' },
  { value: 'staff_issue', label: 'Staff issue' },
  { value: 'equipment_failure', label: 'Equipment failure' },
  { value: 'accident', label: 'Accident' },
  { value: 'other', label: 'Other' },
];
const SEVERITY = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

interface Props {
  orderId?: string | null;
  defaultCustomerName?: string;
  trigger?: React.ReactNode;
}

export function ReportIncidentDialog({ orderId, defaultCustomerName, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultCustomerName ?? '');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState('complaint');
  const [severity, setSeverity] = useState('low');
  const [desc, setDesc] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await reportIncident({
        related_order_id: orderId ?? null,
        customer_name: name,
        customer_phone: phone || null,
        incident_type: type,
        severity,
        description: desc,
      });
      if (r.ok) { toast.success('Incident logged'); setOpen(false); setDesc(''); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={(trigger as React.ReactElement) ?? (
        <Button variant="outline" size="sm"><TriangleAlert className="size-4" /> Report Incident</Button>
      )} />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="font-bold">Report Incident</DialogTitle>
            <DialogDescription className="font-medium">Log a complaint or incident for follow-up.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">Customer name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">Type</Label>
                <Select items={TYPES} value={type} onValueChange={(v) => v && setType(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">Severity</Label>
                <Select items={SEVERITY} value={severity} onValueChange={(v) => v && setSeverity(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SEVERITY.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="font-semibold">Description *</Label>
              <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} required />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Log incident'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
