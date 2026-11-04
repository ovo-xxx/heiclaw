# Deployment risk and what is not guaranteed

HeiClaw is a branded build of PicoClaw. This page is the honest risk picture of running it:
what a deployment exposes, what the software does **not** give you out of the box, and what
you can do about it in an evening. Read it before you put one on a network.

## No warranty

The MIT license already says it: the software is provided **as is**, without warranty of any
kind, and the authors are not liable for its use. On top of that, as the maintainers of this
branded build we state plainly:

- This code has **not** been security-audited or penetration-tested.
- There is no bug bounty, no coordinated-disclosure process, no SLA, and no compensation.
- It is built for single-user, self-hosted use. Multi-tenant use, resale, or any setting where
  a stranger gaining access costs you money or somebody else's data is **outside what this is
  for**.

## What one deployment holds

Everything below lives on the same machine, behind the same login page:

| Asset | Where | What it is worth to an attacker |
| --- | --- | --- |
| A shell | the panel's web terminal, and every tool the agent can call | code execution as the service user |
| Model API keys | `.security.yml`, one entry per `model_name` | your money and your quota |
| Every conversation | the workspace `sessions/*.json` | your secrets, in plaintext |
| Long-term memory | the workspace `memory/MEMORY.md` | what the assistant was told to remember |
| Channel credentials | WeChat/DingTalk/IRC/… tokens in config | your accounts |

The service user is the blast radius. Nothing in this build stops the launcher from running as
root, and a root service means a panel breach is a host breach. Check your unit file
(`systemctl cat <your-service> | grep User=`) before assuming you are sandboxed.

## The four ways this goes wrong

1. **Someone reaches the panel.** The web terminal and the agent's tools are a remote shell for
   anybody who authenticates. If the launcher listens on a routable interface, the only thing
   between the internet and that shell is whatever you put in front of it.
2. **The agent is tricked.** An agent with a shell and no approval step will run what it
   believes it was asked to run. Instructions hidden in a web page, an email attachment, a repo
   README or a pasted log are the most likely real-world path to "the machine did something
   bad".
3. **A machine that can reach it is used by someone else.** A laptop that ran the launcher, or
   a browser still holding the panel session, is the same credential as the deployment.
4. **A key leaks.** Provider keys are long-lived and rarely capped.

## What this build does not give you

These are properties of the software, not of any one server. Do not assume you have them:

- **No privilege separation.** There is no dedicated service user, no container, no
  seccomp/AppArmor profile shipped here. You have to add that yourself.
- **No approval gates.** Tool calls and shell commands run without a human confirming each one.
- **The web terminal is on by default.** It is the fastest way to work and the fastest way to
  lose the machine.
- **A local trust model.** Whoever can log in to the panel is treated as the owner. There is no
  per-user authorization, no roles, and no second factor inside the app - that belongs to the
  auth layer you put in front.

## Reducing the risk without re-architecting

Ordered by what buys the most per minute spent.

**Exposure**

- Bind the launcher to loopback only. Never `--host 0.0.0.0`, never a public panel port.
- Put it behind real auth (an identity provider plus a reverse-proxy auth step), HTTPS only, on
  one hostname you control.
- Firewall the host: SSH (keys only, `PasswordAuthentication no`), 80, 443. Nothing else.
- Do not publish the URL. Every person who knows it is attack surface you cannot audit.
- If you only need chat remotely, turn the web terminal off there and keep it for local use.

**Credentials**

- Give the deployment its **own** provider keys, with a spend cap and a low limit - not the
  account-wide key. Rotating a capped key is an afternoon; rotating a main key is a week.
- Keys belong in `.security.yml` (0600), never in `config.json`, never committed, never in a
  screenshot or a shared log.
- Do not keep the dashboard password as a plaintext file in a synced folder. A password manager
  is not optional.
- Log out of the panel on any machine that is not yours.

**The agent**

- Treat outside content as hostile: web pages, attachments, issues and pasted logs can all
  carry instructions. Do not ask the agent to "read this URL" while a terminal is open unless
  you would run what it might say.
- Keep conversations free of secrets you would not repeat aloud: session files are plaintext.
- Pin the model per session when a cheaper or stricter one is enough for the task.

**The machine**

- Full-disk encryption, screen lock on, and a separate local admin account for anyone who must
  share the machine.
- A dedicated browser profile for the panel: no saved passwords, no extension that can read the
  page, no sync of the session cookie.
- Back up the workspace and `.security.yml` **encrypted**, and rehearse the restore. The
  recovery path matters more than the backup existing.

**When something is wrong**

1. Rotate the provider keys first; that is the money.
2. Stop the service. Loopback-bound, so nothing else dies with it.
3. Change the auth password and revoke existing sessions at your identity provider.
4. Read the proxy access log for what was requested and the launcher log for what executed.
5. Assume the workspace was read: rotate anything that ever appeared in a conversation.

## See also

- [Security configuration](security_configuration.md) for what the panel masks in the browser.
- [Credential encryption](credential_encryption.md) for how keys are stored at rest.
- [Sensitive data filtering](sensitive_data_filtering.md) for what gets scrubbed from logs.
