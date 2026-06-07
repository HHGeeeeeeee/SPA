import { Skeleton } from '@/components/ui/skeleton';

// Shown INSTANTLY in the content area (sidebar/topbar stay put) the moment you
// navigate to any dashboard route, while the server renders + streams the real
// page. This is what turns "click → freeze 1-2s → jump" into "jump instantly →
// skeleton → content". It also gives <Link> prefetch a boundary to cache, so
// hovering/seeing a nav link warms the next page.
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}