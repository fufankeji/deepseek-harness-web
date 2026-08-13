import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import styles from "./SafeMarkdown.module.css";

export function SafeMarkdown({ content, className = "" }: { content: string; className?: string | undefined }) {
  return <div className={`${styles.markdown} ${className}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        a: SafeLink,
        input: ({ type, checked, ...props }) => type === "checkbox"
          ? <input {...props} type="checkbox" checked={checked} disabled />
          : null
      }}
    >
      {content}
    </ReactMarkdown>
  </div>;
}

function SafeLink({ href, children, ...props }: ComponentPropsWithoutRef<"a">) {
  if (!href || !/^(?:https?:|mailto:)/i.test(href)) return <span>{children}</span>;
  return <a {...props} href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
}
