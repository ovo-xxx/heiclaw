import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"

import { MarkdownCodeBlock } from "@/components/chat/message-code-block"
import { cn } from "@/lib/utils"

const BASE =
  "prose dark:prose-invert prose-pre:my-2 prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border prose-pre:bg-zinc-100 prose-pre:p-0 prose-pre:text-zinc-900 dark:prose-pre:bg-zinc-950 dark:prose-pre:text-zinc-100 max-w-none [overflow-wrap:anywhere] break-words"

const TONES = {
  answer:
    "prose-p:my-2 prose-p:whitespace-pre-wrap p-4 text-[15px] leading-relaxed",
  thought:
    "prose-p:my-1.5 prose-p:whitespace-pre-wrap text-[13px] leading-relaxed opacity-70",
  note: "prose-p:my-1.5 prose-p:whitespace-pre-wrap text-[13px] leading-relaxed opacity-75",
} as const

// One markdown pipeline for every piece of assistant text - the answer, a stretch
// of reasoning, the model's note about a tool call. They differ in size and dimming,
// never in how the text is parsed.
export function MarkdownBody({
  content,
  tone,
  className,
}: {
  content: string
  tone: keyof typeof TONES
  className?: string
}) {
  return (
    <div className={cn(BASE, TONES[tone], className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeHighlight]}
        components={{
          pre: MarkdownCodeBlock,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
