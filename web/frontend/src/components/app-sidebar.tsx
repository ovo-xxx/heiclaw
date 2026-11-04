import {
  IconAtom,
  IconBroadcast,
  IconCheck,
  IconChevronLeft,
  IconChevronUp,
  IconKey,
  IconLanguage,
  IconListDetails,
  IconLogout,
  IconLayoutGrid,
  IconSettings,
  IconSunMoon,
  IconTerminal2,
} from "@tabler/icons-react"
import { Link, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import { useTranslation } from "react-i18next"

import { postLauncherDashboardLogout } from "@/api/launcher-auth"
import { ConversationList } from "@/components/chat/conversation-list"
import { ConversationSearch } from "@/components/chat/conversation-search"
import { useStartNewChat } from "@/components/chat/use-start-new-chat"
import { useBranding } from "@/hooks/use-branding"
import { Sidebar, SidebarRail, useSidebar } from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useGateway } from "@/hooks/use-gateway"
import { useSidebarChannels } from "@/hooks/use-sidebar-channels"
import { type ThemePreference, useTheme } from "@/hooks/use-theme"
import { categoryForPath } from "@/lib/nav-categories"
import { cn } from "@/lib/utils"

// ChatGPT-shaped sidebar: a few destinations at the top, every conversation in the
// middle, one settings menu at the bottom. Anything with a second level (频道 today,
// more later) opens as a submenu that replaces this column, with 返回 as its first row.

const primaryNav = [
  { key: "model", labelKey: "navigation.model_group", url: "/models", icon: IconAtom },
  {
    key: "agent",
    labelKey: "navigation.hub",
    url: "/agent/hub",
    icon: IconLayoutGrid,
  },
] as const

const secondaryLinks = [
  { labelKey: "navigation.credentials", url: "/credentials", icon: IconKey },
  { labelKey: "navigation.config", url: "/config", icon: IconSettings },
  { labelKey: "navigation.logs", url: "/logs", icon: IconListDetails },
  { labelKey: "navigation.terminal", url: "/terminal", icon: IconTerminal2 },
] as const

type SidebarView = "main" | "channels"

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation()
  const { isMobile, setOpenMobile } = useSidebar()
  const [view, setView] = React.useState<SidebarView>("main")
  const startNewChat = useStartNewChat()
  const branding = useBranding()
  const [logoFailed, setLogoFailed] = React.useState(false)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const activeCategory = categoryForPath(pathname)

  const closeDrawer = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }, [isMobile, setOpenMobile])

  return (
    <Sidebar
      {...props}
      className="bg-background border-r-border/20 border-r"
    >
      {view === "main" ? (
        <>
          <div className="flex shrink-0 flex-col pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-3">
            <div className="mb-1 flex h-10 shrink-0 items-center px-3">
              {/* The logo starts a conversation, exactly like 新建对话. */}
              <button
                type="button"
                onClick={startNewChat}
                aria-label={branding.name}
                className="rounded-sm transition-opacity hover:opacity-80"
              >
                <img
                  className="h-7"
                  src={logoFailed ? "/logo_with_text.png" : branding.logoUrl}
                  onError={() => setLogoFailed(true)}
                  alt={branding.name}
                />
              </button>
            </div>
            {/* New chat and search sit under the logo, the way the ChatGPT sidebar
                orders them; the list they drive is rendered below the navigation. */}
            <ConversationSearch />
            <div className="flex flex-col gap-1 px-2 pb-1">
              {primaryNav.map((item) => {
                const Icon = item.icon
                const isActive = activeCategory === item.key
                return (
                  <Link
                    key={item.key}
                    to={item.url}
                    onClick={closeDrawer}
                    aria-current={isActive ? "page" : undefined}
                    data-tour={item.key === "model" ? "models-nav" : undefined}
                    className={cn(
                      // 36px rows with a 20px icon, the geometry the ChatGPT sidebar uses.
                      "flex h-9 items-center gap-3 rounded-[10px] px-2.5 text-sm transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn("size-5", isActive ? "opacity-100" : "opacity-60")}
                    />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </Link>
                )
              })}
            </div>
          </div>

          <div aria-hidden className="bg-border/60 mx-3 h-px shrink-0" />

          <ConversationList />
        </>
      ) : (
        <ChannelMenu
          onBack={() => setView("main")}
          onPick={closeDrawer}
        />
      )}

      <div className="border-border/60 shrink-0 border-t px-2 py-2">
        <SettingsMenu onOpenChannels={() => setView("channels")} />
      </div>
      <SidebarRail />
    </Sidebar>
  )
}

// A second level of the sidebar: 返回 first, then the entries. This is the shape every
// future submenu should take, so the way back is always in the same place.
function ChannelMenu({
  onBack,
  onPick,
}: {
  onBack: () => void
  onPick: () => void
}) {
  const { t, i18n } = useTranslation()
  const { allChannelItems } = useSidebarChannels({
    language: (i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase(),
    t,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-3">
      <button
        type="button"
        onClick={onBack}
        className="text-muted-foreground hover:bg-accent/60 hover:text-foreground flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-2.5 text-sm transition-colors"
      >
        <IconChevronLeft className="size-5 opacity-60" />
        <span>{t("navigation.back")}</span>
      </button>
      <div className="text-muted-foreground/60 flex h-7 shrink-0 items-center gap-2 px-2.5 text-[11px] font-medium">
        <IconBroadcast className="size-4 opacity-60" />
        {t("navigation.channels_group")}
      </div>
      {allChannelItems.map((item) => {
        const Icon = item.icon
        return (
          <Link
            key={item.key}
            to={item.url}
            onClick={onPick}
            className="text-muted-foreground hover:bg-accent/60 hover:text-foreground flex h-9 items-center gap-3 rounded-[10px] px-2.5 text-sm transition-colors"
          >
            <Icon className="size-4 opacity-70" />
            <span className="truncate">{item.title}</span>
          </Link>
        )
      })}
    </div>
  )
}

function SettingsMenu({ onOpenChannels }: { onOpenChannels: () => void }) {
  const { i18n, t } = useTranslation()
  const { preference, setThemePreference } = useTheme()
  const { state: gatewayState, restartRequired, restart, start, canStart, loading } = useGateway()

  const handleLogout = async () => {
    const result = await postLauncherDashboardLogout()
    // With a forward-auth gate in front (PICOCLAW_LOGOUT_URL) hand off to it so the
    // gate session ends too; otherwise fall back to the local login page.
    globalThis.location.assign(result.logoutUrl || "/launcher-login")
  }

  const languages = [
    { code: "en", label: "English" },
    { code: "zh", label: "简体中文" },
    { code: "pt-BR", label: "Português (Brasil)" },
    { code: "bn-IN", label: "বাংলা" },
    { code: "cs", label: "Čeština" },
  ]

  const themes: { value: ThemePreference; labelKey: string }[] = [
    { value: "system", labelKey: "navigation.themeSystem" },
    { value: "light", labelKey: "navigation.themeLight" },
    { value: "dark", labelKey: "navigation.themeDark" },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-tour="settings-menu"
          aria-label={t("navigation.settings")}
          className="text-muted-foreground hover:bg-accent/60 hover:text-foreground flex h-9 w-full items-center gap-3 rounded-[10px] px-2.5 text-sm transition-colors"
        >
          <IconSettings className="size-5 opacity-60" />
          <span className="truncate">{t("navigation.settings")}</span>
          <IconChevronUp className="ms-auto size-3.5 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-52">
        <DropdownMenuItem onSelect={onOpenChannels}>
          <IconBroadcast className="size-4 opacity-70" />
          {t("navigation.channels_group")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {secondaryLinks.map((item) => {
          const Icon = item.icon
          return (
            <DropdownMenuItem key={item.url} asChild>
              <Link to={item.url}>
                <Icon className="size-4 opacity-70" />
                {t(item.labelKey)}
              </Link>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconLanguage className="size-4 opacity-70" />
            {languages.find((l) =>
              (i18n.resolvedLanguage ?? i18n.language ?? "").startsWith(
                l.code.slice(0, 2),
              ),
            )?.label ?? t("navigation.language")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {languages.map((language) => (
              <DropdownMenuItem
                key={language.code}
                onClick={() => void i18n.changeLanguage(language.code)}
              >
                {language.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconSunMoon className="size-4 opacity-70" />
            {t("navigation.theme")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {themes.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setThemePreference(option.value)}
              >
                <span className="flex-1">{t(option.labelKey)}</span>
                {preference === option.value && (
                  <IconCheck className="size-3.5 opacity-70" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {gatewayState !== "running" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={loading || !canStart}
              onClick={() => void start()}
            >
              {t("header.gateway.action.start")}
            </DropdownMenuItem>
          </>
        )}
        {restartRequired && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={loading || !canStart}
              onClick={() => void restart()}
            >
              {t("header.gateway.action.restart")}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleLogout()}>
          <IconLogout className="size-4 opacity-70" />
          {t("header.logout.tooltip")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
