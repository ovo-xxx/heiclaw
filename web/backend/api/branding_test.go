package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/sipeed/picoclaw/pkg/config"
)

// Unconfigured deployments keep the bundled brand, and the logo route stays closed.
func TestBrandingDefaultsToPicoClaw(t *testing.T) {
	configPath, cleanup := setupOAuthTestEnv(t)
	defer cleanup()

	h := NewHandler(configPath)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/branding", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Name          string `json:"name"`
		AssistantName string `json:"assistant_name"`
		LogoURL       string `json:"logo_url"`
		CustomLogo    bool   `json:"custom_logo"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Name != "PicoClaw" || body.AssistantName != "picoclaw" || body.LogoURL != "/logo_with_text.png" || body.CustomLogo {
		t.Fatalf("branding = %+v, want the bundled defaults", body)
	}

	recLogo := httptest.NewRecorder()
	mux.ServeHTTP(recLogo, httptest.NewRequest(http.MethodGet, "/api/branding/logo", nil))
	if recLogo.Code != http.StatusNotFound {
		t.Fatalf("logo status = %d, want 404 without a configured file", recLogo.Code)
	}
}

// A configured name and a logo next to the config file are served as the brand.
func TestBrandingServesConfiguredLogo(t *testing.T) {
	configPath, cleanup := setupOAuthTestEnv(t)
	defer cleanup()

	logoPath := filepath.Join(filepath.Dir(configPath), "brand.png")
	if err := os.WriteFile(logoPath, []byte("\x89PNG\r\n\x1a\npayload"), 0o644); err != nil {
		t.Fatalf("write logo: %v", err)
	}

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	cfg.Branding = config.BrandingConfig{Name: "Acme", LogoPath: "brand.png"}
	if err = config.SaveConfig(configPath, cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}

	h := NewHandler(configPath)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/branding", nil))
	var body struct {
		Name          string `json:"name"`
		AssistantName string `json:"assistant_name"`
		LogoURL       string `json:"logo_url"`
		CustomLogo    bool   `json:"custom_logo"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Name != "Acme" || body.AssistantName != "Acme" || !body.CustomLogo {
		t.Fatalf("branding = %+v, want the configured name and logo", body)
	}

	recLogo := httptest.NewRecorder()
	mux.ServeHTTP(recLogo, httptest.NewRequest(http.MethodGet, "/api/branding/logo", nil))
	if recLogo.Code != http.StatusOK {
		t.Fatalf("logo status = %d, want 200", recLogo.Code)
	}
	if got := recLogo.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("content type = %q, want image/png", got)
	}
}
