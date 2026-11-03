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

func TestRecordFileChangeKeepsNewestPerPathInOrder(t *testing.T) {
	ts := &turnState{}
	ts.RecordFileChange(&providers.FileChange{Path: "b.md", Additions: 1})
	ts.RecordFileChange(&providers.FileChange{Path: "a.md", Additions: 5})
	// Editing b.md again must not add a second entry, and a.md keeps its first
	// position so the panel lists files in the order they were touched.
	ts.RecordFileChange(&providers.FileChange{Path: "b.md", Additions: 4, Deletions: 2})
	ts.RecordFileChange(nil)
	ts.RecordFileChange(&providers.FileChange{Path: ""})

	changes := ts.GetFileChanges()
	if len(changes) != 2 {
		t.Fatalf("file changes = %+v, want 2 entries", changes)
	}
	if changes[0].Path != "b.md" || changes[1].Path != "a.md" {
		t.Fatalf("order = %q, %q; want b.md, a.md", changes[0].Path, changes[1].Path)
	}
	if changes[0].Additions != 4 || changes[0].Deletions != 2 {
		t.Fatalf("b.md not replaced by newest change: %+v", changes[0])
	}

	// The caller must not be able to mutate the stored slice through the result.
	changes[1].Additions = -1
	if again := ts.GetFileChanges(); again[1].Additions != 5 {
		t.Fatalf("GetFileChanges() aliases turn state: %+v", again[1])
	}
}
