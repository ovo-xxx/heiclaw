package agent

import (
	"testing"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/providers"
)

// thinkingCapableStub only answers the capability question; nothing else is called.
type thinkingCapableStub struct {
	providers.LLMProvider
}

func (*thinkingCapableStub) SupportsThinking() bool { return true }

type thinkingBlindStub struct {
	providers.LLMProvider
}

func TestThinkingSettingsFromOverride(t *testing.T) {
	cases := []struct {
		level   string
		wantSet bool
		wantLvl ThinkingLevel
	}{
		{"high", true, ThinkingHigh},
		{" off ", true, ThinkingOff},
		{"adaptive", true, ThinkingAdaptive},
		// A value the runtime does not know must not read as "thinking off".
		{"turbo", false, ""},
		{"", false, ""},
	}
	for _, tc := range cases {
		got := thinkingSettingsFromOverride(tc.level)
		if got.configured != tc.wantSet || got.level != tc.wantLvl {
			t.Errorf("thinkingSettingsFromOverride(%q) = %+v, want configured=%v level=%q",
				tc.level, got, tc.wantSet, tc.wantLvl)
		}
	}
}

// The order the whole turn follows: the panel's choice for this message, then the
// model entry's thinking_level, then the agent default.
func TestEffectiveThinkingSettingsPrecedence(t *testing.T) {
	agent := &AgentInstance{ThinkingLevel: ThinkingHigh, ThinkingLevelConfigured: true}
	modelCfg := &config.ModelConfig{ThinkingLevel: "low"}

	if got := effectiveThinkingSettings(agent, modelCfg, thinkingSettings{}); got.level != ThinkingLow {
		t.Errorf("without an override the model entry should rule, got %+v", got)
	}

	override := thinkingSettingsFromOverride("medium")
	if got := effectiveThinkingSettings(agent, modelCfg, override); got.level != ThinkingMedium {
		t.Errorf("the panel's choice should outrank the model entry, got %+v", got)
	}

	// A model entry that spells no thinking level means this model is not asked to
	// think; the agent default only applies when no entry was resolved at all.
	if got := effectiveThinkingSettings(agent, &config.ModelConfig{}, thinkingSettings{}); got.configured {
		t.Errorf("an entry without thinking_level must not inherit the agent default, got %+v", got)
	}
	if got := effectiveThinkingSettings(agent, nil, thinkingSettings{}); got.level != ThinkingHigh {
		t.Errorf("agent default should apply with no model entry, got %+v", got)
	}
}

func TestApplyTurnThinkingOptionsUsesOverride(t *testing.T) {
	exec := &turnExecution{
		llmOpts:           map[string]any{},
		activeModelConfig: &config.ModelConfig{Model: "deepseek-flash", ThinkingLevel: "low"},
		thinkingOverride:  thinkingSettingsFromOverride("high"),
		suppressReasoning: false,
		activeProvider:    &thinkingCapableStub{},
	}
	applyTurnThinkingOptions(exec, &AgentInstance{}, &thinkingCapableStub{}, true)

	if got := exec.llmOpts["thinking_level"]; got != string(ThinkingHigh) {
		t.Fatalf("thinking_level = %v, want the panel's high over the entry's low", got)
	}

	// An entry that cannot be asked for thinking leaves the option out entirely,
	// rather than sending a parameter the provider would reject.
	unsupported := &turnExecution{
		llmOpts:          map[string]any{},
		thinkingOverride: thinkingSettingsFromOverride("high"),
	}
	applyTurnThinkingOptions(unsupported, &AgentInstance{}, &thinkingBlindStub{}, false)
	if _, ok := unsupported.llmOpts["thinking_level"]; ok {
		t.Fatal("a provider without thinking support must not receive thinking_level")
	}
}
