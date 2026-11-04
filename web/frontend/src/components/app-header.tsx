import {
  IconLanguage,
  IconLogout,
  IconMenu2,
  IconMoon,
  IconRefresh,
  IconSun,
} from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

import { postLauncherDashboardLogout } from "@/api/launcher-auth"
import { TopNav } from "@/components/top-nav"
import { Button } from "@/components/ui/button.tsx"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx"
import { Separator } from "@/components/ui/separator.tsx"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useGateway } from "@/hooks/use-gateway.ts"
import { useTheme } from "@/hooks/use-theme.ts"

export function AppHeader() {
  const { i18n, t } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const {
    state: gwState,
    loading: gwLoading,
    canStart,
    restartRequired,
    restart,
  } = useGateway()

  const isRestarting = gwState === "restarting"
  const isStopping = gwState === "stopping"
  const showNotConnectedHint =
    !isRestarting && !isStopping && canStart && (gwState === "stopped" || gwState === "error")

  const handleLogout = async () => {
    const result = await postLauncherDashboardLogout()
    // When a forward-auth gate is in front (PICOCLAW_LOGOUT_URL), hand off to it
    // so the gate session ends too; otherwise fall back to the local login page.
    globalThis.location.assign(result.logoutUrl || "/launcher-login")
  }

  const handleGatewayRestart = () => {
    if (gwLoading || isRestarting || !restartRequired || !canStart) return
    void restart()
  }

  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/60 border-b-border/50 sticky top-0 z-50 flex h-14 shrink-0 items-center justify-between border-b px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-9 items-center justify-center rounded-lg sm:hidden [&>svg]:size-5">
          <IconMenu2 />
        </SidebarTrigger>
        <div className="hidden w-36 shrink-0 items-center sm:flex">
          <Link to="/">
            <img className="w-full" src="/logo_with_text.png" alt="Logo" />
          </Link>
        </div>
        {/* First level of the navigation, next to the logo. */}
        <TopNav />
      </div>

      {/* Center prominent connection status */}
      <div className="pointer-events-none absolute left-1/2 hidden h-full -translate-x-1/2 items-center justify-center lg:flex">
        {showNotConnectedHint && (
          <div className="text-muted-foreground flex items-center gap-2 rounded-full border border-dashed px-4 py-1.5 text-xs shadow-sm backdrop-blur-md">
            <span className="bg-destructive/50 relative flex size-2 shrink-0 items-center justify-center rounded-full">
              <span className="bg-destructive absolute inline-flex size-full animate-ping rounded-full opacity-75"></span>
            </span>
            {t("chat.notConnected")}
          </div>
        )}
      </div>

      <div className="text-muted-foreground flex items-center gap-1 text-sm font-medium md:gap-2">
        {restartRequired && (
          <Tooltip delayDuration={700}>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon-sm"
                className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-500/25"
                onClick={handleGatewayRestart}
                disabled={gwLoading || isRestarting || isStopping || !canStart}
                aria-label={t("header.gateway.action.restart")}
              >
                <IconRefresh className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("header.gateway.restartRequired")}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Language Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <IconLanguage className="size-4.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => i18n.changeLanguage("en")}>
              English
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => i18n.changeLanguage("pt-BR")}>
              Português (Brasil)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => i18n.changeLanguage("bn-IN")}>
              বাংলা
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => i18n.changeLanguage("zh")}>
              简体中文
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => i18n.changeLanguage("cs")}>
              Čeština
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={toggleTheme}
        >
          {theme === "dark" ? (
            <IconSun className="size-4.5" />
          ) : (
            <IconMoon className="size-4.5" />
          )}
        </Button>

        <Separator className="mx-2 my-2" orientation="vertical" />

        {/* Logout */}
        <Tooltip delayDuration={700}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => void handleLogout()}
              aria-label={t("header.logout.tooltip")}
            >
              <IconLogout className="size-4.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("header.logout.tooltip")}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
