import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Tailwind-styled element map so help articles render as polished prose without
// pulling in the typography plugin. Server-rendered (no client interactivity).
const components: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-extrabold tracking-tight mt-6 mb-3 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-bold tracking-tight mt-6 mb-2 border-b border-border pb-1.5">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-bold uppercase tracking-[0.1em] text-muted-foreground mt-5 mb-2">{children}</h3>,
  p: ({ children }) => <p className="text-sm leading-relaxed text-foreground/90 my-2.5">{children}</p>,
  ul: ({ children }) => <ul className="my-2.5 ml-1 flex flex-col gap-1.5 text-sm text-foreground/90">{children}</ul>,
  ol: ({ children }) => <ol className="my-2.5 ml-5 flex list-decimal flex-col gap-1.5 text-sm text-foreground/90 marker:font-bold marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => (
    <li className="leading-relaxed [ul>&]:relative [ul>&]:pl-5 [ul>&]:before:absolute [ul>&]:before:left-1 [ul>&]:before:text-primary [ul>&]:before:content-['▸']">
      {children}
    </li>
  ),
  strong: ({ children }) => <strong className="font-bold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => <a href={href} className="font-semibold text-primary underline underline-offset-2 hover:opacity-80">{children}</a>,
  hr: () => <hr className="my-5 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="my-3 rounded-r-md border-l-4 border-primary/60 bg-primary/5 px-4 py-2 text-sm font-medium text-foreground/90">
      {children}
    </blockquote>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em] font-semibold text-foreground">{children}</code>,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b-2 border-border">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">{children}</th>,
  tr: ({ children }) => <tr className="border-b border-border last:border-0">{children}</tr>,
  td: ({ children }) => <td className="px-3 py-2 align-top text-foreground/90">{children}</td>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}