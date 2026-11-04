import {
  IconFileText,
  IconPencil,
  IconSearch,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react"
import type { ComponentType } from "react"

// A tool call reads as an activity, not as a function name: "终端命令" with a
// command next to it is scannable, "exec({...})" is not. Names the panel has no
// label for keep their raw name rather than being forced into the nearest bucket.
export interface ToolActivity {
  labelKey?: string
  fallbackLabel: string
  icon: ComponentType<{ className?: string }>
}

const activityByTool: Record<string, ToolActivity> = {
  exec: {
    labelKey: "chat.activity.exec",
    fallbackLabel: "exec",
    icon: IconTerminal2,
  },
  read_file: {
    labelKey: "chat.activity.readFile",
    fallbackLabel: "read_file",
    icon: IconFileText,
  },
  write_file: {
    labelKey: "chat.activity.writeFile",
    fallbackLabel: "write_file",
    icon: IconPencil,
  },
  edit_file: {
    labelKey: "chat.activity.editFile",
    fallbackLabel: "edit_file",
    icon: IconPencil,
  },
  append_file: {
    labelKey: "chat.activity.editFile",
    fallbackLabel: "append_file",
    icon: IconPencil,
  },
  list_dir: {
    labelKey: "chat.activity.search",
    fallbackLabel: "list_dir",
    icon: IconSearch,
  },
  glob: {
    labelKey: "chat.activity.search",
    fallbackLabel: "glob",
    icon: IconSearch,
  },
  grep: {
    labelKey: "chat.activity.search",
    fallbackLabel: "grep",
    icon: IconSearch,
  },
  web_search: {
    labelKey: "chat.activity.web",
    fallbackLabel: "web_search",
    icon: IconWorld,
  },
  web_fetch: {
    labelKey: "chat.activity.web",
    fallbackLabel: "web_fetch",
    icon: IconWorld,
  },
}

export function toolActivity(name: string): ToolActivity {
  const key = name.trim().toLowerCase()
  const known = activityByTool[key]
  if (known) {
    return known
  }
  return {
    fallbackLabel: name,
    icon: IconFileText,
  }
}
