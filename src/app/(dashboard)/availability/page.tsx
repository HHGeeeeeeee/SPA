import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Therapist availability now lives in Shift Schedule (the roster is the source
// of truth for who's on duty; the "Therapists free now" tile lists them).
export default function AvailabilityRedirect() {
  redirect('/shift-schedule');
}
