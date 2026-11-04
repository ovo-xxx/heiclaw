# Deployment risk and what is not guaranteed

HeiClaw is a personal build of PicoClaw. This page is the honest risk picture: what the
deployment actually exposes, what we have deliberately **not** hardened, and what you can do
about it in an evening. Read it before you put this behind a domain.

## No warranty

The MIT license already says it: the software is provided **as is**, without warranty of any
kind, and the authors are not liable for its use. On top of that, as the maintainers of this
branded build we state plainly:

- This code has **not** been security-audited or penetration-tested.
- There is no bug bounty, no disclosure process, no SLA, and no compensation.
- It is a single-user deployment. Multi-tenant use, resale, or anything where a stranger
  gaining access costs you money or someone else's data is **outside what this is for**.

## What one deployment actually holds

Everything below sits on the same machine, reachable through the same panel:

| Asset | Where | What it is worth to an attacker |
| --- | --- | --- |
| A shell | the panel's web terminal, and every tool the agent can call | code execution as the service user |
| Model API keys | `.security.yml`, one entry per `model_name` | your money and your quota |
| Every conversation | `/var/lib/picoclaw/workspace/sessions/*.json` | your secrets, in plaintext |
| Long-term memory | `workspace/memory/MEMORY.md` | what the assistant was told to remember |
| Channel credentials | WeChat/DingTalk/IRC/… tokens in config | your accounts |

The service user is the blast radius. On our server the launcher runs as **root**, so a
compromised panel is a compromised machine. That is a choice, recorded here, not an accident.

## The four ways this goes wrong

1. **Someone reaches the panel.** The only thing between the internet and a root shell is the
   auth layer in front of it (Tinyauth behind Caddy `forward_auth`). The launcher itself is
   bound to `127.0.0.1` and is not reachable from outside — keep it that way.
2. **The agent is tricked.** An agent with a shell and full permissions will run what it
   believes it was asked to run. Instructions hidden in a web page, an email, a repo README or
   a pasted log are the most likely real-world path to "the computer did something bad".
3. **The machine you administer is used by someone else.** A laptop that runs the launcher, or
   a browser that still holds the panel session, is the same credential as the domain.
4. **A key leaks.** Provider keys are long-lived and rarely capped.

## What we are not doing, and why it matters

Decisions taken for this deployment, stated so nobody is surprised later:

- **No privilege separation.** The service stays root; there is no dedicated user, no
  container, no seccomp/AppArmor profile. A panel breach is a host breach.
- **No approval gates.** Tool and shell calls run without a human confirming each one.
- **The web terminal is enabled.** It is the fastest way to work and the fastest way to lose.
- **Local trust model.** Whoever can log in to the panel is treated as you.

## Reducing the risk without re-architecting

Ordered by what buys the most per minute spent.

**Exposure**

- Bind the launcher to loopback only. Never `--host 0.0.0.0`, never a public `:18800`.
- Put it behind real auth (Tinyauth/oidc), HTTPS only, and one hostname you control.
- Firewall the host: 22 (keys only, `PasswordAuthentication no`), 80, 443. Nothing else.
- Do not publish the URL. Every person who knows it is an attack surface you cannot audit.

**Credentials**

- Give the deployment its **own** provider keys, with a spend cap and a low limit, not the
  account-wide key. Rotating a leaked capped key is an afternoon; rotating a main key is a week.
- Keys belong in `.security.yml` (0600), never in `config.json`, never committed, never in a
  screenshot or a shared log.
- Do not store the dashboard password as a plaintext file in a synced folder. If you keep one,
  keep it in a password manager, not on disk.
- Log out of the panel when you are done on a machine that is not yours.

**The agent**

- Treat untrusted input as hostile: web pages, attachments, issues, and pasted content can all
  carry instructions. Do not ask the agent to "read this URL" while a terminal is open unless
  you would run what it might say.
- Keep conversations free of secrets you would not repeat aloud: session files are plaintext.
- If you only need chat remotely, disable the terminal there and keep it for local use.

**The machine**

- Full-disk encryption on the laptop, screen lock on, and a separate local admin account for
  anyone who must share it.
- A dedicated browser profile for the panel: no saved passwords, no extension that can read
  the page, no sync of the session cookie.
- Back up `workspace/` and `.security.yml` encrypted, and know how to restore — the recovery
  path matters more than the backup existing.

**When something is wrong**

1. Rotate the provider keys first; that is the money.
2. Stop the service (`systemctl stop picoclaw-launcher`) — loopback-bound, so nothing else dies.
3. Change the auth password and revoke sessions at the identity provider.
4. Read `/var/log/caddy/*-access.log` for what was requested, and the launcher log for what ran.
5. Assume the workspace is read: rotate anything that appeared in a conversation.

## See also

- [Security configuration](security_configuration.md) for what the panel masks in the browser.
- [Credential encryption](credential_encryption.md) for how keys are stored at rest.
- [Sensitive data filtering](sensitive_data_filtering.md) for what gets scrubbed from logs.
