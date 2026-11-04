import type { ComponentType } from "react"

import {
  IconAtom,
  IconBroadcast,
  IconKey,
  IconListDetails,
  IconMessages,
  IconRobot,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconTerminal2,
  IconTools,
} from "@tabler/icons-react"

// The navigation is two levels: one category per tab in the top bar, and the
// category's pages in the left rail. Both levels read these definitions, so a page
// cannot appear under one category in the top bar and another in the rail.
//
// Channels are the exception: their items come from the configured channel list, so
// the caller passes them in instead of reading a static row.

export type NavCategoryKey = "chat" | "model" | "channels" | "agent" | "services"

export interface NavSubItem {
  title: string
  url: string
  icon: ComponentType<{ className?: string }>
  translateTitle?: boolean
}

export interface NavCategory {
  key: NavCategoryKey
  labelKey: string
  icon: ComponentType<{ className?: string }>
  items: NavSubItem[]
}

export const chatNavCategory: NavCategory = {
  key: "chat",
  labelKey: "navigation.chat",
  icon: IconMessages,
  // The conversation list is this category's second level, so it has no pages.
  items: [],
}

export const modelNavItems: NavSubItem[] = [
  { title: "navigation.models", url: "/models", icon: IconAtom },
  { title: "navigation.credentials", url: "/credentials", icon: IconKey },
]

export const agentNavItems: NavSubItem[] = [
  { title: "navigation.hub", url: "/agent/hub", icon: IconSearch },
  { title: "navigation.skills", url: "/agent/skills", icon: IconSparkles },
  { title: "navigation.tools", url: "/agent/tools", icon: IconTools },
]

export const servicesNavItems: NavSubItem[] = [
  { title: "navigation.config", url: "/config", icon: IconSettings },
  { title: "navigation.logs", url: "/logs", icon: IconListDetails },
  { title: "navigation.terminal", url: "/terminal", icon: IconTerminal2 },
]

// Which category a route belongs to. A path listed nowhere keeps the previous
// category, which is what the top bar does while the user reads a detail page.
const categoryPrefixes: Record<NavCategoryKey, string[]> = {
  chat: ["/"],
  model: ["/models", "/credentials"],
  channels: ["/channels"],
  agent: ["/agent"],
  services: ["/config", "/logs", "/terminal"],
}

export function categoryForPath(pathname: string): NavCategoryKey | undefined {
  for (const [key, prefixes] of Object.entries(categoryPrefixes)) {
    const matched = prefixes.some(
      (prefix) =>
        prefix === "/" ? pathname === "/" : pathname.startsWith(prefix),
    )
    if (matched) {
      return key as NavCategoryKey
    }
  }
  return undefined
}

// A category only gets a tab when it has somewhere to go, so 频道 disappears rather
// than becoming a dead tab when no channel is configured.
export function buildCategories(channelItems: NavSubItem[]): NavCategory[] {
  return [
    chatNavCategory,
    {
      key: "model",
      labelKey: "navigation.model_group",
      icon: IconAtom,
      items: modelNavItems,
    },
    ...(channelItems.length > 0
      ? [
          {
            key: "channels" as const,
            labelKey: "navigation.channels_group",
            icon: IconBroadcast,
            items: channelItems,
          },
        ]
      : []),
    {
      key: "agent",
      labelKey: "navigation.agent_group",
      icon: IconRobot,
      items: agentNavItems,
    },
    {
      key: "services",
      labelKey: "navigation.services",
      icon: IconSettings,
      items: servicesNavItems,
    },
  ]
}
