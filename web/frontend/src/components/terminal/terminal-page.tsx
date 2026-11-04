import { useTranslation } from "react-i18next"

import { PageHeader } from "@/components/page-header"
import { TerminalWorkspace } from "@/components/terminal/terminal-workspace"

/**
 * The full-screen mode of the same terminal the chat dock uses: tabs, splits
 * and sockets are shared through the manager, so navigating between the two
 * keeps the shells alive. New shells come from the strip's own +, which is the
 * only place that can both start a session and give it a slot in a layout.
 */
export function TerminalPage() {
  const { t } = useTranslation()

  return (
    <div className="bg-background flex h-full flex-col">
      <PageHeader title={t("navigation.terminal")} />

      <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <TerminalWorkspace
          variant="page"
          className="border-border min-h-0 flex-1 border"
        />
      </div>
    </div>
  )
}
