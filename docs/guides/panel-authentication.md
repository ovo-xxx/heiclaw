# Running the Web Panel Behind an Authentication Proxy

The panel ships with its own dashboard login. If you already run one sign-in for
every service on the host, you can hand that job to your reverse proxy instead and
let the panel trust the identity the proxy asserts. Exactly one layer should be able
to say "this request is allowed"; two layers that disagree produce the confusing case
where a request is admitted by one and rejected by the other.

This guide covers the trusted-proxy mode, what stays available if the proxy is down,
and two panel features that depend on the loopback rule: the docked terminal and the
per-turn cost figures.

## How the trust decision is made

Enable the mode with environment variables read by the launcher:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PICOCLAW_TRUSTED_PROXY_AUTH` | unset | Enables the mode. Off unless set to a truthy value. |
| `PICOCLAW_TRUSTED_PROXY_HEADER` | `Remote-User` | Request header carrying the authenticated identity. |
| `PICOCLAW_TRUSTED_PROXY_SECRET_HEADER` | `X-Trusted-Proxy-Secret` | Header name for the shared secret, when one is configured. |
| `PICOCLAW_TRUSTED_PROXY_SECRET` | unset | If set, the secret the proxy must present. |
| `PICOCLAW_LOGOUT_URL` | unset | Where the panel's sign-out button sends the browser instead of clearing a local session. |

The identity is only accepted when the request's immediate peer is a loopback address.
That is what makes a header safe to trust: a client on the network is never the
loopback peer of the launcher process, so it cannot assert an identity by setting a
header. Put the proxy on the same host (or bind the launcher to an address only your
proxy can reach) and the rule does the work.

`PICOCLAW_TRUSTED_PROXY_SECRET` is optional because the loopback rule already excludes
remote clients. Set it anyway if anything else may connect to the loopback listener on
that host - another service on a shared machine, for instance.

## Proxy side

Any forward-auth gate works; the panel only reads one header. With Caddy and a gate
service on the same host:

```caddyfile
ai.example.com {
	handle /pico/* {
		forward_auth gate.example.com {
			uri /api/verify
			copy_headers Remote-User
			# also forward the shared secret if PICOCLAW_TRUSTED_PROXY_SECRET is set
		}
		reverse_proxy 127.0.0.1:18800
	}
}
```

The gate must be the thing that decides, and the proxy must be the only process that
can reach the launcher. Do not also keep the panel's own password enabled for the same
paths: pick the layer, then delete the other one from the request path.

## If the gate is unreachable

The panel's own login (`LauncherDashboardAuth`) is what runs when the trusted-proxy
mode is off, and it stays in the binary. Keep one way in that does not depend on the
external identity provider: a gate you cannot reach is otherwise a panel you cannot
reach, and the fix then needs console access to the host.

Two practical forms:

- Leave `PICOCLAW_TRUSTED_PROXY_AUTH` unset on a second listener bound to loopback, so
  you can sign in locally through an SSH tunnel while the gate is down.
- Or keep a break-glass account in the gate itself that does not depend on the same
  upstream directory the rest of the fleet uses.

## Docked terminal

The chat panel can open a terminal against the host running the launcher. Because that
is command execution, it inherits the same loopback requirement: the terminal is only
reachable through the listener the launcher binds, so if you expose 18800 directly you
have exposed a shell regardless of which auth layer is in front of it. Keep the proxy
in front, and treat `PICOCLAW_TRUSTED_PROXY_SECRET` as mandatory on shared hosts.

## What the panel costs per turn

The panel prices each LLM call from the token counts the provider reports, including
the cached portion, and shows the money in the turn's statistics. Prices live in
`pkg/providers/pricing`:

```go
"deepseek-v4-flash": {
    Name:     "deepseek-v4-flash",
    Currency: "CNY",
    OffPeak:  Rate{InputPerMTok: 1, CacheReadPerMTok: 0.02, OutputPerMTok: 4},
    Peak:     Rate{InputPerMTok: 2, CacheReadPerMTok: 0.04, OutputPerMTok: 8},
    Band:     deepSeekBand,
    Source:   "https://api-docs.deepseek.com/zh-cn/quick_start/pricing · read 2026-11-04",
},
```

Rates are per million tokens, in the row's own currency. `Source` is displayed with the
figure, so a stale row is visible without opening the code; keep the read date in it.

Rates the user types live in the config's `pricing` section, keyed by provider and then
by upstream model identifier: `pricing.deepseek.models["deepseek-flash"]`. The editor is
the panel's 价目 page, which groups rows exactly that way and only offers providers that
have a row. A rate equal to the built-in figure is not saved, so restoring the built-in
price leaves no override behind; a custom rate applies all day because one figure has no
peak rule to follow, and the panel labels the call as custom rates. A model with no row
gets no price form at all, because three numbers cannot invent a currency.

The key is the **current upstream model identifier** — the string in `model:` of a config
entry, not the `model_name:` alias the user picks. `TableFor` matches it exactly (after
dropping a `provider/` prefix), so a row keyed `deepseek-flash` prices a `flash` alias that
points at that identifier and nothing else. When a provider renames a model, the row key
moves with it and the old id goes into `legacyModelNames`, because stored turns keep the
id they were billed under and must not lose their price; `provider_metadata.go`'s
`CommonModels` is the name the picker offers, and a row that matches neither silently
stops pricing without any error anywhere.

A row carries its own peak rule, or none:

- `Band` names the offset in seconds, the half-open local ranges, and any holiday dates
  that pull a weekday out of the band. Saturday and Sunday are never peak.
- `Band: nil` bills `OffPeak` all day. Most providers are this shape; do not invent a
  window for them.
- A rule that cannot be parsed degrades to "never peak" rather than to a guessed
  window, because guessing bills the wrong rate.

Two honesty rules the panel follows, and that a new row must not break:

1. **A model with no row shows no cost.** The token counts still appear, but no money
   figure is invented from a neighbouring model's price.
2. **A turn that mixes currencies reports the part it can price and counts the rest as
   uncounted calls**, rather than summing two currencies into one number.

DeepSeek's window, quoted from its pricing page:

> 北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；
> 其余时段，包括周末及中国法定节假日全天均为空闲时段。

Both ranges are half-open, so 12:00:00 and 18:00:00 are already off-peak. The holiday
list is the State Council notice for the year, and it needs a new entry each year:
until it is added, a weekday in an unlisted holiday is billed at the peak rate. That is
a wrong-looking figure you can see and explain, not a silent discount - so update the
list when the notice is published.

## See also

- [Configuration Guide](configuration.md) for the launcher's own settings.
- [Providers & Model Configuration](providers.md) for `model_list` entries.
- [Security documentation](../security/security_configuration.md) for the credentials
  the panel masks in the browser.
