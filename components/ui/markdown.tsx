import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";
import { textDir } from "@/lib/dir";

/** Markdown for text people write. Raw HTML is never rendered, and links open safely. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div dir={textDir(children)} className={cn("prose-chat", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const safe = href && /^(https?:|mailto:|\/)/i.test(href) ? href : undefined;
            return (
              <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            );
          },
          img: () => null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
