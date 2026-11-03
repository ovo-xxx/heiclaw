package middleware

import (
	"crypto/subtle"
	"net"
	"net/http"
	"os"
	"strings"
)

// TrustedProxyAuthConfig delegates dashboard authentication to a local reverse
// proxy (for example Caddy with a forward-auth gate in front of it).
//
// It is disabled unless explicitly enabled, and it only trusts requests whose
// immediate peer is a loopback address: a remote client can never assert an
// identity by sending headers, because it is never the loopback peer of the
// launcher process.
type TrustedProxyAuthConfig struct {
	Enabled        bool
	IdentityHeader string
	SecretHeader   string
	Secret         string
}

// TrustedProxyAuthFromEnv builds the configuration from PICOCLAW_TRUSTED_PROXY_*.
func TrustedProxyAuthFromEnv() TrustedProxyAuthConfig {
	return TrustedProxyAuthConfig{
		Enabled:        boolEnv("PICOCLAW_TRUSTED_PROXY_AUTH"),
		IdentityHeader: firstNonEmpty(os.Getenv("PICOCLAW_TRUSTED_PROXY_HEADER"), "Remote-User"),
		SecretHeader:   firstNonEmpty(os.Getenv("PICOCLAW_TRUSTED_PROXY_SECRET_HEADER"), "X-Trusted-Proxy-Secret"),
		Secret:         os.Getenv("PICOCLAW_TRUSTED_PROXY_SECRET"),
	}
}

// Identity returns the identity asserted by a trusted loopback proxy.
func (c TrustedProxyAuthConfig) Identity(r *http.Request) (string, bool) {
	if !c.Enabled || r == nil {
		return "", false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	if ip == nil || !ip.IsLoopback() {
		return "", false
	}
	if c.Secret != "" {
		got := r.Header.Get(c.SecretHeader)
		if subtle.ConstantTimeCompare([]byte(got), []byte(c.Secret)) != 1 {
			return "", false
		}
	}
	id := strings.TrimSpace(r.Header.Get(c.IdentityHeader))
	if id == "" {
		return "", false
	}
	return id, true
}

func boolEnv(key string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func firstNonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
