package api

import (
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/sipeed/picoclaw/pkg/config"
)

const (
	defaultBrandLogo  = "/logo_with_text.png"
	brandingLogoRoute = "/api/branding/logo"
)

func (h *Handler) registerBrandingRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/branding", h.handleGetBranding)
	mux.HandleFunc("GET /api/branding/logo", h.handleGetBrandingLogo)
}

// resolveBranding reads the configured name and logo. The logo path may be relative to
// the config file, so a deployment can ship the image next to its config; a path that
// does not point at a file is treated as "not configured" rather than served blindly.
func (h *Handler) resolveBranding() (config.BrandingConfig, string) {
	branding := config.BrandingConfig{}
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		return branding, ""
	}
	branding = cfg.Branding
	logoPath := strings.TrimSpace(branding.LogoPath)
	if logoPath == "" {
		return branding, ""
	}
	if !filepath.IsAbs(logoPath) {
		logoPath = filepath.Join(filepath.Dir(h.configPath), logoPath)
	}
	info, statErr := os.Stat(logoPath)
	if statErr != nil || info.IsDir() {
		return branding, ""
	}
	return branding, logoPath
}

// handleGetBranding tells the panel what to call itself. It is public, like the login
// status, because the login page draws the logo before a session exists.
//
//	GET /api/branding
func (h *Handler) handleGetBranding(w http.ResponseWriter, r *http.Request) {
	branding, logoPath := h.resolveBranding()
	logoURL := defaultBrandLogo
	if logoPath != "" {
		// The mtime busts the cache when a deployment replaces its logo file.
		version := ""
		if info, err := os.Stat(logoPath); err == nil {
			version = fmt.Sprintf("?v=%d", info.ModTime().Unix())
		}
		logoURL = brandingLogoRoute + version
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"name":           branding.EffectiveName(),
		"assistant_name": branding.EffectiveAssistantName(),
		"logo_url":       logoURL,
		"custom_logo":    logoPath != "",
	})
}

// handleGetBrandingLogo serves the configured image. Only the file named in the config
// is reachable - there is no path parameter to traverse.
//
//	GET /api/branding/logo
func (h *Handler) handleGetBrandingLogo(w http.ResponseWriter, r *http.Request) {
	_, logoPath := h.resolveBranding()
	if logoPath == "" {
		http.NotFound(w, r)
		return
	}
	// The API middleware pre-sets application/json for every /api response, and
	// ServeFile only sniffs a type when the header is empty.
	setImageContentType(w, logoPath)
	w.Header().Set("Cache-Control", "public, max-age=300")
	http.ServeFile(w, r, logoPath)
}

func setImageContentType(w http.ResponseWriter, path string) {
	if contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(path))); contentType != "" {
		w.Header().Set("Content-Type", contentType)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()
	head := make([]byte, 512)
	n, _ := io.ReadFull(file, head)
	w.Header().Set("Content-Type", http.DetectContentType(head[:n]))
}
