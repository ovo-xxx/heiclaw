import { IconPlus } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@/components/page-header"
import { terminalManager } from "@/components/terminal/terminal-manager"
import { TerminalWorkspace } from "@/components/terminal/terminal-workspace"
import { Button } from "@/components/ui/button"

/**
 * The full-screen mode of the same terminal the chat dock uses: tabs, splits
 * and sockets are shared through the manager, so navigating between the two
 * keeps the shells alive.
 */
export function TerminalPage() {
  const { t } = useTranslation()

  return (
    <div className="bg-background flex h-full flex-col">
      <PageHeader
        title={t("navigation.terminal")}
        children={
          <Button
            variant="outline"
            size="sm"
            onClick={() => terminalManager.createTab()}
          >
            <IconPlus className="size-4" />
            {t("pages.terminal.newTab")}
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
        <TerminalWorkspace
          variant="page"
          className="border-border min-h-0 flex-1 border"
        />
      </div>
    </div>
  )
}
