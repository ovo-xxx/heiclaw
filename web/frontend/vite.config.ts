import path from "path"

import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 2048,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:18800",
        changeOrigin: true,
        headers: devIdentityHeaders(),
      },
      "/pico/media": {
        target: "http://localhost:18800",
        changeOrigin: true,
        headers: devIdentityHeaders(),
      },
      "/pico/ws": {
        target: "ws://localhost:18800",
        ws: true,
        headers: devIdentityHeaders(),
      },
    },
  },
})

// A launcher started with PICOCLAW_TRUSTED_PROXY_AUTH=1 reads the user from the
// gate's header, which is what Caddy supplies in production. Set
// PICOCLAW_DEV_REMOTE_USER to let the dev proxy play the same part; leave it unset
// and nothing is added, so the launcher's own login still applies.
function devIdentityHeaders(): Record<string, string> | undefined {
  const user = process.env.PICOCLAW_DEV_REMOTE_USER?.trim()
  return user ? { "remote-user": user } : undefined
}
