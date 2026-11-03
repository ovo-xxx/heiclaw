import { createFileRoute } from "@tanstack/react-router"

import { TerminalPage } from "@/components/terminal/terminal-page"

export const Route = createFileRoute("/terminal")({
  component: TerminalPage,
})
