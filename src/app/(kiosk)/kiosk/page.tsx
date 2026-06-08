import { readKioskContext } from '@/lib/kiosk-session';
import { listKioskBranches } from '@/app/(kiosk)/kiosk/actions';
import { ArmScreen } from '@/components/kiosk/arm-screen';
import { IntakeKiosk } from '@/components/kiosk/intake-kiosk';

export const dynamic = 'force-dynamic';

// Armed (valid kiosk cookie) → run the public guest form. Otherwise → the
// staff-only ARM screen (branch + passcode).
export default async function KioskPage() {
  const ctx = await readKioskContext();
  if (!ctx) {
    const branches = await listKioskBranches();
    return <ArmScreen branches={branches} />;
  }
  return <IntakeKiosk branchName={ctx.branchName} branchCode={ctx.branchCode} />;
}
