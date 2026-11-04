import { html } from "diff2html"
import "diff2html/bundles/css/diff2html.min.css"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { useTheme } from "@/hooks/use-theme"
import { cn } from "@/lib/utils"

// The unified diff the tools produce is handed to diff2html rather than painted by
// hand: it colours added, removed and word-level changed text the way the code
// review UIs people already know do. Its own file header is hidden because the path
// and the line counts are drawn above, once per file.
//
// Content safety is not assumed here: the library escapes the diff body, so a file
// containing markup cannot inject it into the panel.
export function FileDiff({
  path,
  diff,
  additions,
  deletions,
}: {
  path: string
  diff: string
  additions: number
  deletions: number
}) {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const markup = useMemo(() => {
    if (!diff.trim()) {
      return ""
    }
    return html(diff, {
      outputFormat: "line-by-line",
      drawFileList: false,
      matching: "lines",
    })
  }, [diff])

  return (
    <div
      className={cn(
        "border-border/60 bg-card overflow-hidden rounded-xl border text-[12px]",
        "[--d2h-bg-color:var(--card)] [--d2h-border-color:var(--border)]",
        "[--d2h-file-header-bg-color:var(--muted)] [--d2h-info-bg-color:var(--muted)]",
        // The library's own dark palette is selected by a class on the wrapper.
        theme === "dark" && "d2h-dark-color-scheme",
      )}
    >
      <div className="border-border/60 text-muted-foreground/80 flex items-baseline justify-between gap-2 border-b px-3 py-1.5">
        <span className="min-w-0 truncate font-mono text-[11px]">{path}</span>
        <span className="shrink-0 text-[11px] tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">
            +{additions}
          </span>{" "}
          <span className="text-red-600 dark:text-red-400">-{deletions}</span>
        </span>
      </div>

      {markup ? (
        // Long lines scroll inside the card; without this the table widened the page
        // and the diff ran off the bottom of the layout. The inner box keeps its
        // natural width and a floor of 100%, so the two number columns never collapse
        // to nothing when the pane is narrow.
        <div className="overflow-x-auto">
          <div
            className="w-max min-w-full [&_.d2h-code-line]:font-mono [&_.d2h-code-linenumber]:w-[1%] [&_.d2h-code-linenumber]:whitespace-nowrap [&_.d2h-file-header]:hidden [&_.d2h-file-wrapper]:m-0 [&_.d2h-file-wrapper]:rounded-none [&_.d2h-file-wrapper]:border-0 [&_.line-num1]:min-w-[2.5rem] [&_.line-num2]:min-w-[2.5rem]"
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </div>
      ) : (
        <div className="text-muted-foreground/60 px-3 py-2 text-[11px]">
          {t("chat.diffEmpty")}
        </div>
      )}
    </div>
  )
}
