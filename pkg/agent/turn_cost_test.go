package agent

import (
	"testing"
	"time"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/providers"
)

// A turn's money is decided per LLM call, not per turn: DeepSeek doubles the rate
// inside its peak window, and a turn that starts at 11:50 and finishes at 12:10
// straddles the boundary. So the record carries the wall clock of each call and the
// price computed from it.
func TestLLMCallStatPricesTheCallThatAnswered(t *testing.T) {
	startedAt := time.Date(2026, time.November, 4, 3, 0, 0, 0, time.FixedZone("CST", 8*3600))
	exec := &turnExecution{
		activeModelConfig: &config.ModelConfig{
			ModelName: "flash",
			Provider:  "deepseek",
			Model:     "deepseek-v4-flash",
		},
		llmModel: "flash",
		response: &providers.LLMResponse{
			Usage: &providers.UsageInfo{
				PromptTokens:     1000,
				CacheReadTokens:  90_000,
				CompletionTokens: 500,
				TotalTokens:      91_500,
			},
		},
	}

	stat := llmCallStat(exec, 1, 1, 2*time.Second, startedAt)
	if stat.StartedAtMS != startedAt.UnixMilli() {
		t.Fatalf("started_at_ms = %d, want %d", stat.StartedAtMS, startedAt.UnixMilli())
	}
	// The alias the user picked ("flash") is what the panel shows; the price row has
	// to come from the identifier the provider was asked for.
	if stat.Model != "flash" {
		t.Fatalf("model = %q, want the alias the turn selected", stat.Model)
	}
	if stat.Cost == nil {
		t.Fatal("no cost recorded for a priced model")
	}
	if stat.Cost.Table != "deepseek-v4-flash" || stat.Cost.Peak {
		t.Fatalf("cost = %+v, want the off-peak deepseek-v4-flash row", stat.Cost)
	}
	if stat.Cost.Amount < 0.0047 || stat.Cost.Amount > 0.0049 {
		t.Fatalf("amount = %v, want about 0.0048 CNY", stat.Cost.Amount)
	}
}

// A model outside the price table must not borrow a neighbour's rates, and the turn
// total then stays absent rather than showing a free turn.
func TestLLMCallStatLeavesUnpricedModelUncosted(t *testing.T) {
	exec := &turnExecution{
		activeModelConfig: &config.ModelConfig{ModelName: "mini", Model: "some-unknown-model"},
		response:          &providers.LLMResponse{Usage: &providers.UsageInfo{PromptTokens: 10}},
	}
	stat := llmCallStat(exec, 1, 1, time.Second, time.Now())
	if stat.Cost != nil {
		t.Fatalf("cost = %+v, want none", stat.Cost)
	}

	ts := &turnState{startedAt: time.Now().Add(-time.Second)}
	ts.RecordLLMCall(stat)
	if stats := ts.GetTurnStats(nil); stats == nil || stats.Cost != nil {
		t.Fatalf("turn cost = %+v, want no cost object", stats)
	}
}

func TestTurnCostSumsItsCalls(t *testing.T) {
	ts := &turnState{startedAt: time.Now().Add(-time.Second)}
	ts.RecordLLMCall(llmCallStat(&turnExecution{
		activeModelConfig: &config.ModelConfig{Model: "deepseek-v4-flash"},
		response: &providers.LLMResponse{
			Usage: &providers.UsageInfo{PromptTokens: 1_000_000, TotalTokens: 1_000_000},
		},
	}, 1, 1, time.Second, time.Date(2026, time.November, 4, 3, 0, 0, 0, time.FixedZone("CST", 8*3600))))
	ts.RecordLLMCall(llmCallStat(&turnExecution{
		activeModelConfig: &config.ModelConfig{Model: "deepseek-v4-flash"},
		response: &providers.LLMResponse{
			Usage: &providers.UsageInfo{PromptTokens: 1_000_000, TotalTokens: 1_000_000},
		},
	}, 2, 1, time.Second, time.Date(2026, time.November, 4, 10, 0, 0, 0, time.FixedZone("CST", 8*3600))))

	stats := ts.GetTurnStats(nil)
	if stats == nil || stats.Cost == nil {
		t.Fatalf("turn stats = %+v, want a cost", stats)
	}
	// 1M fresh input: 1元 off-peak + 2元 peak.
	if stats.Cost.Amount < 2.99 || stats.Cost.Amount > 3.01 {
		t.Fatalf("amount = %v, want 3 CNY", stats.Cost.Amount)
	}
	if stats.Cost.PeakCalls != 1 || stats.Cost.OffPeakCalls != 1 || stats.Cost.Currency != "CNY" {
		t.Fatalf("cost = %+v, want one call in each band, CNY", stats.Cost)
	}
}
