'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { submitFeedback } from '@/app/(dashboard)/sales-orders/actions';

interface Props {
  orderId: string;
  orderItemId: string;
  serviceName: string;
  therapistName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({ orderId, orderItemId, serviceName, therapistName, open, onOpenChange }: Props) {
  const [score, setScore] = useState<number | null>(null);
  const [age, setAge] = useState('');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    if (score == null) return toast.error('Please pick a score (1-10)');
    startTransition(async () => {
      const r = await submitFeedback({
        order_id: orderId,
        order_item_id: orderItemId,
        score,
        age: age ? Number(age) : null,
        email: email || null,
        comment: comment || null,
      });
      if (r.ok) { toast.success('Feedback submitted'); onOpenChange(false); router.refresh(); }
      else toast.error(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-bold">Feedback</DialogTitle>
          <DialogDescription className="font-medium">
            {serviceName}{therapistName ? ` · ${therapistName}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-2">
            <Label className="font-semibold">Score (1–10) *</Label>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setScore(n)}
                  className={`size-9 rounded-md text-sm font-bold transition-colors ${
                    score === n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fb-age" className="font-semibold">Age</Label>
              <Input id="fb-age" type="number" min="1" max="120" value={age} onChange={(e) => setAge(e.target.value)} placeholder="optional" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fb-email" className="font-semibold">Email</Label>
              <Input id="fb-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="fb-comment" className="font-semibold">Comment</Label>
            <Textarea id="fb-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="optional" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={pending}>{pending ? 'Submitting…' : 'Submit feedback'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
