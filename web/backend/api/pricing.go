package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/providers/pricing"
)

// The price table is edited per provider: the provider's billing shape (currency,
// peak window, holidays, source) is fixed in pkg/providers/pricing, and what the user
// can change is the numbers on each of that provider's rows.

type pricingRates struct {
	InputPerMTok     float64 `json:"input_per_mtok"`
	CacheReadPerMTok float64 `json:"cache_read_per_mtok"`
	OutputPerMTok    float64 `json:"output_per_mtok"`
}

type pricingModel struct {
	Model   string        `json:"model"`
	Builtin pricingRates  `json:"builtin"`
	Custom  *pricingRates `json:"custom,omitempty"`
	Source  string        `json:"source,omitempty"`
	// Peak says the provider bills this model in two bands; a custom rate applies to
	// both of them because it is one figure.
	Peak bool `json:"peak"`
}

type pricingProvider struct {
	Provider string         `json:"provider"`
	Currency string         `json:"currency"`
	Models   []pricingModel `json:"models"`
}

func ratesFromTable(table pricing.Table) pricingRates {
	return pricingRates{
		InputPerMTok:     table.OffPeak.InputPerMTok,
		CacheReadPerMTok: table.OffPeak.CacheReadPerMTok,
		OutputPerMTok:    table.OffPeak.OutputPerMTok,
	}
}

func (h *Handler) registerPricingRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/pricing", h.handleListPricing)
	mux.HandleFunc("PUT /api/pricing/{provider}", h.handleUpdatePricing)
}

// handleListPricing returns every provider that has price rows, with the built-in
// numbers and whatever the user has overridden.
//
//	GET /api/pricing
func (h *Handler) handleListPricing(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}

	providers := make([]pricingProvider, 0, 4)
	for _, provider := range pricing.Providers() {
		rows := pricing.RowsForProvider(provider)
		if len(rows) == 0 {
			continue
		}
		saved := cfg.Pricing[provider]
		models := make([]pricingModel, 0, len(rows))
		for _, row := range rows {
			model := pricingModel{
				Model:   row.Name,
				Builtin: ratesFromTable(row),
				Source:  row.Source,
				Peak:    row.Band != nil,
			}
			if custom, ok := saved.Models[row.Name]; ok && !custom.IsZero() {
				model.Custom = &pricingRates{
					InputPerMTok:     custom.InputPerMTok,
					CacheReadPerMTok: custom.CacheReadPerMTok,
					OutputPerMTok:    custom.OutputPerMTok,
				}
			}
			models = append(models, model)
		}
		providers = append(providers, pricingProvider{
			Provider: provider,
			Currency: rows[0].Currency,
			Models:   models,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"providers": providers})
}

// handleUpdatePricing replaces one provider's overrides. A model whose three rates are
// all zero is removed from the file, and a provider left with no models is removed too,
// so "use the built-in numbers" leaves no trace.
//
//	PUT /api/pricing/{provider}
func (h *Handler) handleUpdatePricing(w http.ResponseWriter, r *http.Request) {
	provider := strings.ToLower(strings.TrimSpace(r.PathValue("provider")))
	if _, ok := pricing.CurrencyForProvider(provider); !ok {
		http.Error(w, fmt.Sprintf("provider %q has no price rows", provider), http.StatusNotFound)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var incoming struct {
		Models map[string]pricingRates `json:"models"`
	}
	if err := json.Unmarshal(body, &incoming); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON: %v", err), http.StatusBadRequest)
		return
	}

	known := map[string]bool{}
	for _, row := range pricing.RowsForProvider(provider) {
		known[row.Name] = true
	}
	saved := config.ProviderPricing{Models: map[string]config.ModelPricing{}}
	names := make([]string, 0, len(incoming.Models))
	for name := range incoming.Models {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if !known[name] {
			http.Error(w, fmt.Sprintf("model %q has no price row for provider %q", name, provider), http.StatusBadRequest)
			return
		}
		rates := incoming.Models[name]
		if rates.InputPerMTok < 0 || rates.CacheReadPerMTok < 0 || rates.OutputPerMTok < 0 {
			http.Error(w, "rates must not be negative", http.StatusBadRequest)
			return
		}
		entry := config.ModelPricing{
			InputPerMTok:     rates.InputPerMTok,
			CacheReadPerMTok: rates.CacheReadPerMTok,
			OutputPerMTok:    rates.OutputPerMTok,
		}
		if !entry.IsZero() {
			saved.Models[name] = entry
		}
	}

	h.configMu.Lock()
	defer h.configMu.Unlock()

	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}
	if cfg.Pricing == nil {
		cfg.Pricing = map[string]config.ProviderPricing{}
	}
	if len(saved.Models) == 0 {
		delete(cfg.Pricing, provider)
	} else {
		cfg.Pricing[provider] = saved
	}
	if err := config.SaveConfig(h.configPath, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save config: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"provider": provider, "saved": len(saved.Models)})
}
