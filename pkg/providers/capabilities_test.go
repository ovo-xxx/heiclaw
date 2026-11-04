package providers

import (
	"encoding/json"
	"reflect"
	"testing"
)

// DeepSeek publishes the effort ladder and the level it applies by itself; the panel
// reads both so the picker shows the truth instead of 关 for a model that reasons.
func TestParseModelCapabilityDeepSeekShape(t *testing.T) {
	raw := json.RawMessage(`{
		"id": "deepseek-flash",
		"object": "model",
		"context_window": 1048576,
		"effort": {"supported_levels": ["low", "high", "max"], "default_level": "high"}
	}`)
	id, capability, ok := parseModelCapability(raw)
	if !ok || id != "deepseek-flash" {
		t.Fatalf("parse = %q, %v, %v", id, capability, ok)
	}
	if !capability.SupportsThinking {
		t.Fatal("a model with an effort ladder must be reported as thinking-capable")
	}
	if capability.DefaultLevel != "high" {
		t.Errorf("default level = %q, want high", capability.DefaultLevel)
	}
	if !reflect.DeepEqual(capability.Levels, []string{"low", "high", "max"}) {
		t.Errorf("levels = %v, want [low high max]", capability.Levels)
	}
}

// OpenRouter has no effort object: it lists the reasoning parameter and states the
// default effort next to it.
func TestParseModelCapabilityOpenRouterShape(t *testing.T) {
	raw := json.RawMessage(`{
		"id": "vendor/model-x",
		"supported_parameters": ["temperature", "reasoning"],
		"reasoning": {"default_effort": "medium", "default_enabled": true}
	}`)
	_, capability, ok := parseModelCapability(raw)
	if !ok {
		t.Fatal("entry should parse")
	}
	if !capability.SupportsThinking || capability.DefaultLevel != "medium" {
		t.Fatalf("capability = %+v, want thinking with default medium", capability)
	}
	if len(capability.Levels) != 0 {
		t.Errorf("levels = %v, want none (the list does not state a ladder)", capability.Levels)
	}
}

// A model that says nothing about reasoning is reported as not thinking, which is
// what its own list says - the caller can still fall back to its own judgement.
func TestParseModelCapabilityWithoutReasoning(t *testing.T) {
	raw := json.RawMessage(`{"id": "meituan/longcat-flash-lite", "context_length": 256000}`)
	_, capability, ok := parseModelCapability(raw)
	if !ok {
		t.Fatal("entry should parse")
	}
	if capability.SupportsThinking || capability.DefaultLevel != "" || len(capability.Levels) != 0 {
		t.Fatalf("capability = %+v, want nothing", capability)
	}
}

func TestNormalizeThinkingLevels(t *testing.T) {
	cases := map[string]string{
		"low": "low", "minimal": "low", "LOW": "low",
		"medium": "medium", "mid": "medium",
		"high": "high",
		"max":  "max", "xhigh": "max", "x-high": "max",
		"adaptive": "adaptive", "auto": "adaptive",
		// "off" survives the single-level mapping; the list normalizer drops it,
		// since a ladder of choices never includes "off" (the picker offers it).
		"off": "off", "": "", "turbo": "",
	}
	for input, want := range cases {
		if got := normalizeThinkingLevel(input); got != want {
			t.Errorf("normalizeThinkingLevel(%q) = %q, want %q", input, got, want)
		}
	}

	got := normalizeThinkingLevels([]string{"off", "low", "LOW", "high", "bogus"})
	if !reflect.DeepEqual(got, []string{"low", "high"}) {
		t.Errorf("normalizeThinkingLevels = %v, want [low high]", got)
	}
}

// Without an api base or a model id there is nothing to ask, and the lookup has to
// say so rather than invent a capability.
func TestLookupModelCapabilityWithoutEndpoint(t *testing.T) {
	if _, ok := LookupModelCapability(nil, nil); ok {
		t.Error("nil config must not resolve")
	}
}
