package providers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/config"
)

// ModelCapability is what a provider's own model list says about thinking. The
// panel uses it for two things it cannot guess: whether the model reasons at all,
// and which effort the provider applies when the request states none.
//
// Providers publish this in slightly different shapes, so both are read here:
//
//	DeepSeek   {"effort": {"supported_levels": ["low","high","max"], "default_level": "high"}}
//	OpenRouter {"supported_parameters": ["reasoning", ...],
//	            "reasoning": {"default_effort": "medium", "default_enabled": true}}
//
// Anything unrecognised is left out rather than guessed.
type ModelCapability struct {
	SupportsThinking bool
	DefaultLevel     string
	Levels           []string
}

// capabilityCacheTTL keeps one fetch per endpoint for a while; model lists change
// rarely and the panel asks on every load.
const capabilityCacheTTL = 10 * time.Minute

type capabilityEntry struct {
	expires time.Time
	models  map[string]ModelCapability
}

var (
	capabilityMu       sync.Mutex
	capabilityCache    = map[string]capabilityEntry{}
	capabilityInFlight = map[string]chan struct{}{}
)

// LookupModelCapability asks the provider's own /models for this entry's model. The
// boolean is false when the endpoint could not be read or does not describe the
// model, so callers can fall back to their own judgement instead of showing a guess.
func LookupModelCapability(ctx context.Context, mc *config.ModelConfig) (ModelCapability, bool) {
	if mc == nil {
		return ModelCapability{}, false
	}
	base := strings.TrimRight(strings.TrimSpace(ResolveAPIBase(mc)), "/")
	modelID := strings.TrimSpace(mc.Model)
	if base == "" || modelID == "" {
		return ModelCapability{}, false
	}

	models, ok := capabilityModels(ctx, base, mc.APIKey())
	if !ok {
		return ModelCapability{}, false
	}
	capability, found := models[strings.ToLower(modelID)]
	return capability, found
}

// capabilityModels returns the parsed model list for one endpoint, fetching it at
// most once per TTL. Concurrent callers wait for the single in-flight fetch.
func capabilityModels(ctx context.Context, base, apiKey string) (map[string]ModelCapability, bool) {
	capabilityMu.Lock()
	if entry, ok := capabilityCache[base]; ok && time.Now().Before(entry.expires) {
		capabilityMu.Unlock()
		return entry.models, true
	}
	if wait, ok := capabilityInFlight[base]; ok {
		capabilityMu.Unlock()
		select {
		case <-wait:
		case <-ctx.Done():
			return nil, false
		case <-time.After(6 * time.Second):
			return nil, false
		}
		capabilityMu.Lock()
		entry, ok := capabilityCache[base]
		capabilityMu.Unlock()
		return entry.models, ok
	}
	done := make(chan struct{})
	capabilityInFlight[base] = done
	capabilityMu.Unlock()

	models, ok := fetchCapabilities(ctx, base, apiKey)

	capabilityMu.Lock()
	if ok {
		capabilityCache[base] = capabilityEntry{
			expires: time.Now().Add(capabilityCacheTTL),
			models:  models,
		}
	}
	delete(capabilityInFlight, base)
	capabilityMu.Unlock()
	close(done)
	return models, ok
}

func fetchCapabilities(ctx context.Context, base, apiKey string) (map[string]ModelCapability, bool) {
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, base+"/models", nil)
	if err != nil {
		return nil, false
	}
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, false
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, false
	}

	var payload struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || len(payload.Data) == 0 {
		return nil, false
	}

	models := make(map[string]ModelCapability, len(payload.Data))
	for _, raw := range payload.Data {
		id, capability, ok := parseModelCapability(raw)
		if ok {
			models[strings.ToLower(id)] = capability
		}
	}
	return models, len(models) > 0
}

func parseModelCapability(raw json.RawMessage) (string, ModelCapability, bool) {
	var entry struct {
		ID     string `json:"id"`
		Effort *struct {
			SupportedLevels []string `json:"supported_levels"`
			DefaultLevel    string   `json:"default_level"`
		} `json:"effort,omitempty"`
		SupportedParameters []string `json:"supported_parameters,omitempty"`
		Reasoning           *struct {
			DefaultEffort  string `json:"default_effort,omitempty"`
			DefaultEnabled *bool  `json:"default_enabled,omitempty"`
			Mandatory      bool   `json:"mandatory,omitempty"`
		} `json:"reasoning,omitempty"`
	}
	if err := json.Unmarshal(raw, &entry); err != nil || strings.TrimSpace(entry.ID) == "" {
		return "", ModelCapability{}, false
	}

	capability := ModelCapability{}
	if entry.Effort != nil && len(entry.Effort.SupportedLevels) > 0 {
		capability.SupportsThinking = true
		capability.Levels = normalizeThinkingLevels(entry.Effort.SupportedLevels)
		capability.DefaultLevel = normalizeThinkingLevel(entry.Effort.DefaultLevel)
	}
	if entry.Reasoning != nil {
		capability.SupportsThinking = true
		if capability.DefaultLevel == "" {
			capability.DefaultLevel = normalizeThinkingLevel(entry.Reasoning.DefaultEffort)
		}
	}
	for _, parameter := range entry.SupportedParameters {
		if strings.EqualFold(parameter, "reasoning") || strings.EqualFold(parameter, "include_reasoning") {
			capability.SupportsThinking = true
			break
		}
	}
	if !capability.SupportsThinking {
		return entry.ID, capability, true
	}
	return entry.ID, capability, true
}

// normalizeThinkingLevel maps a provider's own vocabulary onto the levels this
// runtime understands. Unknown names are dropped rather than passed through, since a
// level the runtime cannot build a request for is worse than no choice at all.
func normalizeThinkingLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "off", "none", "disabled":
		return "off"
	case "low", "minimal", "light":
		return "low"
	case "medium", "mid", "default":
		return "medium"
	case "high":
		return "high"
	case "max", "xhigh", "x-high", "extra-high":
		return "max"
	case "adaptive", "auto":
		return "adaptive"
	default:
		return ""
	}
}

func normalizeThinkingLevels(levels []string) []string {
	seen := make(map[string]bool, len(levels))
	out := make([]string, 0, len(levels))
	for _, level := range levels {
		normalized := normalizeThinkingLevel(level)
		if normalized == "" || normalized == "off" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, normalized)
	}
	return out
}
