import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Props {
  title: string;
  description: string;
  planned?: string[];
}

export function ModulePlaceholder({ title, description, planned }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        <Badge variant="secondary" className="font-bold">Coming soon</Badge>
      </div>
      <Card className="border-dashed bg-muted/30">
        <CardContent className="py-8">
          <p className="text-sm font-semibold text-muted-foreground">{description}</p>
          {planned && planned.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                Planned for this module
              </p>
              <ul className="flex flex-col gap-1.5">
                {planned.map((p) => (
                  <li key={p} className="text-sm font-medium flex items-start gap-2">
                    <span className="text-primary mt-0.5">•</span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
