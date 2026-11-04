# 把 Web 面板放在统一鉴权反代后面

面板自带一套 dashboard 登录。如果你已经为主机上的所有服务准备了一层统一登录，可以
把这一步交给反代，让面板信任反代断言的身份。能判定"这个请求可以进"的层只应该有一层；
两层各自判断，就会出现一层放行、另一层拒绝的那种说不清的情况。

本文覆盖 trusted-proxy 模式、代理挂掉时还剩什么，以及依赖 loopback 规则的两个面板功能：
内嵌终端和每轮的费用数字。

## 信任是怎么判定的

由 launcher 读取这几个环境变量来启用：

| 变量 | 默认 | 含义 |
| --- | --- | --- |
| `PICOCLAW_TRUSTED_PROXY_AUTH` | 未设置 | 启用该模式。不设或设为非真值都是关闭。 |
| `PICOCLAW_TRUSTED_PROXY_HEADER` | `Remote-User` | 携带已认证身份的请求头。 |
| `PICOCLAW_TRUSTED_PROXY_SECRET_HEADER` | `X-Trusted-Proxy-Secret` | 共享密钥的请求头名（配置了密钥时生效）。 |
| `PICOCLAW_TRUSTED_PROXY_SECRET` | 未设置 | 一旦设置，反代必须带上这个密钥。 |
| `PICOCLAW_LOGOUT_URL` | 未设置 | 面板"退出"按钮跳去的地址，而不是本地清 cookie。 |

只有当请求的直接对端是 loopback 地址时，身份才会被接受。这正是信任一个请求头安全的
前提：网络上的客户端永远不是 launcher 进程的 loopback 对端，所以它没法靠塞请求头来
冒充身份。把代理放在同一台主机上（或者把 launcher 绑到只有你的代理能访问的地址），
这条规则本身就完成了隔离。

`PICOCLAW_TRUSTED_PROXY_SECRET` 是可选的，因为 loopback 规则已经排除了远程客户端。
但如果同一台机器上还有别的东西能连到这个 loopback 监听（共享主机上的其他服务），就
应当设置。

## 代理侧

任何 forward-auth 门都能用，面板只读一个请求头。Caddy 与同机门服务的例子：

```caddyfile
ai.example.com {
	handle /pico/* {
		forward_auth gate.example.com {
			uri /api/verify
			copy_headers Remote-User
			# 若设置了 PICOCLAW_TRUSTED_PROXY_SECRET，也要把密钥转过来
		}
		reverse_proxy 127.0.0.1:18800
	}
}
```

判定必须由门来做，并且只有代理能访问 launcher。不要在同样的路径上再把面板自己的密码
也留着：选定一层，就把另一层从请求路径上撤掉。

## 门不可达时

关掉 trusted-proxy 模式时跑的就是面板自带的登录（`LauncherDashboardAuth`），它一直留在
二进制里。请务必保留一条不依赖外部身份源的入口：门连不上就等于面板连不上，那时候只能
从主机控制台去救。

两种可行的做法：

- 在第二个只绑 loopback 的监听上留空 `PICOCLAW_TRUSTED_PROXY_AUTH`，门挂掉时通过 SSH
  隧道走本地登录。
- 或者在门里留一个 break-glass 账号，不依赖其他服务共用的那份目录。

## 内嵌终端

对话面板可以对着跑 launcher 的那台主机开终端。因为这就是命令执行，它继承同样的
loopback 要求：终端只能经由 launcher 绑定的监听访问，所以如果你把 18800 直接暴露出去，
那就等于暴露了一个 shell，前置哪一层鉴权都一样。保持代理在前，并在共享主机上把
`PICOCLAW_TRUSTED_PROXY_SECRET` 当成必配。

## 面板怎么算每轮的钱

面板按供应商返回的 token 数（含命中缓存的那部分）逐次计价，并在这一轮的统计里显示金额。
价格放在 `pkg/providers/pricing`：

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

单价都是"每百万 token"，用该行自己的币种。`Source` 会跟着金额一起显示，所以价表过期
不用翻代码就能看出来；请把它连取用日期一起写上。

模型条目可以在 `pricing` 里自带单价——输入、缓存命中、输出，每百万 token。它会替换价行
里的数字，并且全天适用：用户填的一个数没有高峰规则可依。币种仍由价行给出，面板会把这种
调用标成"自定义价目"；没有对应价行的模型不显示价格表单，因为三个数字编不出一个币种。

键名是**现行的上游模型标识**——配置条目里 `model:` 的值，不是用户选的 `model_name:` 别名。
`TableFor` 精确匹配（去掉 `provider/` 前缀后），所以 `deepseek-flash` 这行只对指向该标识的
`flash` 别名计价。供应商改名时键名跟着改，旧标识写进 `legacyModelNames`——已存下的回合仍
带着当初计费时的旧 id，不能因此丢掉金额；`pkg/providers/provider_metadata.go` 的
`CommonModels` 是选择器给出的名字，两边都对不上时这一行只是安静地不再计价，任何地方都不
会报错。

每行自带自己的高峰规则，或者不带：

- `Band` 声明时区偏移（秒）、左闭右开的本地区间，以及把工作日拉出高峰的节假日。
  周六周日永远不算高峰。
- `Band: nil` 全天按 `OffPeak` 计价。大多数供应商就是这个形状，别替它们编一个时段。
- 解析不了的规则会退化成"永不高峰"，而不是猜一个时段——猜错就是按错价计费。

面板遵守两条诚实规则，新增价行也不许破坏：

1. **没有对应价行的模型不显示费用。** token 数照显示，但不会拿隔壁模型的价格凑一个钱数。
2. **一轮里混了币种时，只汇总能算的那部分**，其余计入"未计价调用"，而不是把两种币种
   加成一个数字。

DeepSeek 的时段，照抄其定价页：

> 北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；
> 其余时段，包括周末及中国法定节假日全天均为空闲时段。

两段都是左闭右开，所以 12:00:00 和 18:00:00 本身已经是闲时。节假日表来自国务院当年的
放假安排通知，每年都要补一行：没补上之前，落在未登记假期里的工作日会按高峰计价。这是个
看得见、也解释得清的错误数字，而不是一处悄悄打折——所以通知一出就把它更新进来。

## 另见

- [配置指南](configuration.zh.md)：launcher 自身的设置。
- [Provider 与模型配置](providers.zh.md)：`model_list` 条目。
- [安全配置](../security/security_configuration.md)：面板在浏览器里如何遮蔽凭据。
