/**
 * Dashboard launcher auth API.
 * Uses plain fetch (not launcherFetch) to avoid redirect loops on auth pages.
 */
export type LoginResult =
  | { ok: true }
  | { ok: false; status: number; error: string }

export async function postLauncherDashboardLogin(
  password: string,
): Promise<LoginResult> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ password: password.trim() }),
  })
  if (res.ok) return { ok: true }

  return {
    ok: false,
    status: res.status,
    error: await readLauncherAuthError(res),
  }
}

export type LauncherAuthStatus = {
  authenticated: boolean
  /** true when a bcrypt password has been stored in the DB */
  initialized: boolean
}

export async function getLauncherAuthStatus(): Promise<LauncherAuthStatus> {
  const res = await fetch("/api/auth/status", {
    method: "GET",
    credentials: "same-origin",
  })
  if (!res.ok) {
    throw new Error(`status ${res.status}`)
  }
  return (await res.json()) as LauncherAuthStatus
}

export type LauncherLogoutResult = { ok: boolean; logoutUrl?: string }

export async function postLauncherDashboardLogout(): Promise<LauncherLogoutResult> {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: "{}",
  })
  if (!res.ok) return { ok: false }
  try {
    const body = (await res.json()) as { logout_url?: string }
    return { ok: true, logoutUrl: body.logout_url }
  } catch {
    return { ok: true }
  }
}

export type SetupResult = { ok: true } | { ok: false; error: string }

export async function postLauncherDashboardSetup(
  password: string,
  confirm: string,
): Promise<SetupResult> {
  const res = await fetch("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      password: password.trim(),
      confirm: confirm.trim(),
    }),
  })
  if (res.ok) return { ok: true }
  return { ok: false, error: await readLauncherAuthError(res) }
}

async function readLauncherAuthError(res: Response): Promise<string> {
  let msg = `Request failed with status ${res.status}`
  try {
    const j = (await res.json()) as { error?: string }
    if (j.error) msg = j.error
  } catch {
    /* ignore */
  }
  return msg
}
