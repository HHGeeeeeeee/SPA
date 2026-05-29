'use client';

import { useState, useTransition } from 'react';
import { MoreVertical, Plus, Snowflake, Power } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { topUpCard, setCardStatus } from '@/app/(dashboard)/stored-value-cards/actions';

interface Props {
  card: { id: string; card_no: string; status: string };
}

export function CardRowActions({ card }: Props) {
  const [pending, startTransition] = useTransition();
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const isActive = card.status === 'active';

  function doTopUp(e: React.FormEvent) {
    e.preventDefault();
    if (!Number(amount)) return toast.error('Enter an amount');
    startTransition(async () => {
      const r = await topUpCard({ card_id: card.id, amount: Number(amount) });
      if (r.ok) { toast.success('Topped up'); setTopUpOpen(false); setAmount(''); }
      else toast.error(r.error);
    });
  }

  function toggle() {
    startTransition(async () => {
      const r = await setCardStatus(card.id, isActive ? 'suspended' : 'active');
      if (r.ok) toast.success(isActive ? 'Card suspended' : 'Card reactivated');
      else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" disabled={pending}>
                <MoreVertical className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTimeout(() => setTopUpOpen(true))} disabled={!isActive}>
              <Plus className="size-4" />
              Top Up
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isActive ? (
              <DropdownMenuItem variant="destructive" onClick={toggle}>
                <Snowflake className="size-4" />
                Suspend
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={toggle}>
                <Power className="size-4" />
                Reactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={doTopUp}>
            <DialogHeader>
              <DialogTitle className="font-bold">Top Up · {card.card_no}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="tu-amt" className="font-semibold">Amount</Label>
              <Input id="tu-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-2" autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setTopUpOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending}>Top up</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
