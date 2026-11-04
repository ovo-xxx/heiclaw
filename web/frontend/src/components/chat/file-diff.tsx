// git-diff-view renders the unified diff hunks produced by the backend
// (pkg/tools/shared/diff_result.go) natively as a React tree. The library's
// DiffView does not include a file header (no file name / +/- counts), so we
// draw our own and stack the diff table below it.
//
// Theme switching: the library's internal initTheme effect does not notify
// subscribers when the theme prop changes on an already-initialised DiffFile
// (initRaw / build* are no-ops because their has* flags are already set).
// Forcing a remount via key={theme} sidesteps that — the trade-off is the diff
// re-parses on every theme flip, which is cheap for chat-sized diffs.
import { DiffModeEnum, DiffView } from "@git-diff-view/react"
import "@git-diff-view/react/styles/diff-view.css"
import { IconChevronRight } from "@tabler/icons-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { useHtmlTheme } from "@/hooks/use-theme"
import { cn } from "@/lib/utils"

// A turn that touched several files, or one file with a long diff, starts folded so
// the answer is not pushed off the screen; a small edit opens straight away.
const FOLD_AFTER_FILES = 4
const FOLD_AFTER_LINES = 60

export function diffOpensByDefault(
  fileCount: number,
  changedLines: number,
): boolean {
  return fileCount <= FOLD_AFTER_FILES && changedLines <= FOLD_AFTER_LINES
}

export function FileDiff({
  path,
  diff,
  additions,
  deletions,
  hunks,
  oldPath,
  newPath,
  fileLang,
  binary,
  defaultOpen = true,
}: {
  path: string
  diff?: string
  additions: number
  deletions: number
  hunks?: string[]
  oldPath?: string
  newPath?: string
  fileLang?: string
  binary?: boolean
  defaultOpen?: boolean
}) {
  const { t } = useTranslation()
  const theme = useHtmlTheme()
  const [open, setOpen] = useState(defaultOpen)

  const hasHunks = hunks !== undefined && hunks.length > 0
  const name = newPath ?? path

  return (
    <div
      className={cn(
        "border-border/60 bg-card overflow-hidden rounded-xl border text-[12px]",
      )}
    >
      {/* File header — the library does not ship one, so we draw the path
          and +/- counts ourselves, matching the card style we had before. It is
          the fold control: the counts stay readable while the body is hidden, and
          the diff is only parsed once the file is opened. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={name}
        className={cn(
          "text-muted-foreground/80 hover:text-foreground flex w-full items-baseline gap-2 px-3 py-1.5 text-left",
          open && "border-border/60 border-b",
        )}
      >
        <IconChevronRight
          className={cn(
            "size-3 shrink-0 self-center transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 truncate font-mono text-[11px]">{name}</span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">
            +{additions}
          </span>{" "}
          <span className="text-red-600 dark:text-red-400">-{deletions}</span>
        </span>
      </button>

      {open &&
        (hasHunks ? (
          <DiffView
            key={theme}
            data={{
              oldFile: {
                fileName: oldPath ?? path,
                fileLang: fileLang ?? null,
                content: null,
              },
              newFile: {
                fileName: newPath ?? path,
                fileLang: fileLang ?? null,
                content: null,
              },
              hunks: hunks!,
            }}
            diffViewMode={DiffModeEnum.Unified}
            diffViewTheme={theme === "dark" ? "dark" : "light"}
            diffViewHighlight
          />
        ) : binary ? (
          <div className="text-muted-foreground/60 px-3 py-2 text-[11px]">
            {t("chat.diffBinary")}
          </div>
        ) : diff && diff.trim() ? (
          <pre className="text-muted-foreground/90 max-h-[24rem] overflow-auto px-3 py-2 font-mono text-[11px] whitespace-pre-wrap">
            {diff}
          </pre>
        ) : (
          <div className="text-muted-foreground/60 px-3 py-2 text-[11px]">
            {t("chat.diffEmpty")}
          </div>
        ))}
    </div>
  )
}
