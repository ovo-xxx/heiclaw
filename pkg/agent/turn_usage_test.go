package agent

import (
	"testing"

	"github.com/sipeed/picoclaw/pkg/providers"
)

func TestRecordUsageAccumulatesAcrossLLMCalls(t *testing.T) {
	ts := &turnState{}
	ts.RecordUsage(&providers.UsageInfo{PromptTokens: 100, CompletionTokens: 20, TotalTokens: 120})
	ts.RecordUsage(&providers.UsageInfo{PromptTokens: 150, CompletionTokens: 30, TotalTokens: 180})

	usage := ts.GetTurnUsage()
	if usage == nil {
		t.Fatal("GetTurnUsage() = nil after two recorded calls")
	}
	if usage.PromptTokens != 250 || usage.CompletionTokens != 50 || usage.TotalTokens != 300 {
		t.Fatalf("turn usage = %+v, want 250/50/300", usage)
	}

	// A returned pointer must not alias the turn state, or callers could mutate
	// the running turn's counters.
	usage.PromptTokens = -1
	if again := ts.GetTurnUsage(); again.PromptTokens != 250 {
		t.Fatalf("GetTurnUsage() aliases turn state: %d", again.PromptTokens)
	}
}

func TestGetTurnUsageNilWhenNothingRecorded(t *testing.T) {
	ts := &turnState{}
	ts.RecordUsage(nil)
	if got := ts.GetTurnUsage(); got != nil {
		t.Fatalf("GetTurnUsage() = %+v, want nil", got)
	}
}
