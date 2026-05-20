import { ModulePlaceholder } from '@/components/layout/module-placeholder';

export const dynamic = 'force-dynamic';

export default function ShiftSchedulePage() {
  return (
    <ModulePlaceholder
      title="Shift Schedule"
      description="Employee shift planning across branches and business units."
      planned={[
        'EmployeeShift roster with 5 shift types',
        'Cross-branch staffing for multi-store employees',
        'Resource / station availability overlay',
        'Manager-adjustable schedules',
      ]}
    />
  );
}
