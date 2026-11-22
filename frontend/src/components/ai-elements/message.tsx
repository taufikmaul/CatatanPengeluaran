import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  from: "user" | "assistant";
}

export function Message({ from, className, children, ...props }: MessageProps) {
  return (
    <div
      data-role={from}
      className={cn(
        "group flex w-full flex-col gap-1.5",
        from === "user" ? "is-user items-end" : "is-assistant items-start",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function MessageContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed break-words",
        "group-[.is-user]:max-w-[85%] group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:bg-primary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-primary-foreground",
        "group-[.is-assistant]:w-full group-[.is-assistant]:max-w-full group-[.is-assistant]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function MessageResponse({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5 text-sm leading-relaxed text-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: pChildren }) => (
            <p className="text-pretty leading-relaxed [&:not(:last-child)]:mb-2">{pChildren}</p>
          ),
          h1: ({ children: hChildren }) => (
            <h3 className="mt-3 mb-1.5 text-base font-semibold tracking-tight text-foreground">
              {hChildren}
            </h3>
          ),
          h2: ({ children: hChildren }) => (
            <h4 className="mt-3 mb-1.5 text-sm font-semibold tracking-tight text-foreground">
              {hChildren}
            </h4>
          ),
          h3: ({ children: hChildren }) => (
            <h5 className="mt-2.5 mb-1 text-sm font-semibold text-foreground">{hChildren}</h5>
          ),
          ul: ({ children: ulChildren }) => (
            <ul className="my-1.5 ml-4 list-disc space-y-1 marker:text-muted-foreground">
              {ulChildren}
            </ul>
          ),
          ol: ({ children: olChildren }) => (
            <ol className="my-1.5 ml-4 list-decimal space-y-1 marker:text-muted-foreground">
              {olChildren}
            </ol>
          ),
          li: ({ children: liChildren }) => <li className="pl-0.5">{liChildren}</li>,
          strong: ({ children: sChildren }) => (
            <strong className="font-semibold text-foreground">{sChildren}</strong>
          ),
          blockquote: ({ children: bChildren }) => (
            <blockquote className="my-2 border-l-2 border-primary/50 pl-3 text-muted-foreground">
              {bChildren}
            </blockquote>
          ),
          code: ({ className: codeClassName, children: cChildren }) => {
            const isBlock = Boolean(codeClassName && codeClassName.includes("language-"));
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-xl bg-muted p-3 font-mono text-xs text-foreground">
                  {cChildren}
                </code>
              );
            }
            return (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {cChildren}
              </code>
            );
          },
          pre: ({ children: preChildren }) => (
            <pre className="my-2 overflow-x-auto rounded-xl bg-muted p-0">{preChildren}</pre>
          ),
          table: ({ children: tChildren }) => (
            <div className="my-2.5 w-full overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full border-collapse text-left text-xs tabular-nums">
                {tChildren}
              </table>
            </div>
          ),
          thead: ({ children: thChildren }) => (
            <thead className="border-b border-border bg-muted/60">{thChildren}</thead>
          ),
          th: ({ children: thCell }) => (
            <th className="whitespace-nowrap px-3 py-2 font-semibold text-foreground">
              {thCell}
            </th>
          ),
          td: ({ children: tdCell }) => (
            <td className="border-t border-border/60 px-3 py-2 align-top text-foreground/90">
              {tdCell}
            </td>
          ),
          hr: () => <hr className="my-3 border-border" />,
          a: ({ href, children: aChildren }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
            >
              {aChildren}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
