package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/sipeed/picoclaw/pkg/memory"
	"github.com/sipeed/picoclaw/pkg/providers"
)

// Turn token usage has to survive the whole read path: it is written into the
// session JSONL by the agent, stored by pkg/memory, and mapped into the
// transcript the panel renders.
func TestTurnUsageSurvivesJSONLRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store, err := memory.NewJSONLStore(dir)
	if err != nil {
		t.Fatalf("NewJSONLStore: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	key := "agent:main:pico:direct:pico:usage-test"
	usage := &providers.UsageInfo{PromptTokens: 1200, CompletionTokens: 340, TotalTokens: 1540}

	if err := store.AddFullMessage(ctx, key, providers.Message{
		Role:    "user",
		Content: "跑一下 uptime",
	}); err != nil {
		t.Fatalf("AddFullMessage user: %v", err)
	}
	if err := store.AddFullMessage(ctx, key, providers.Message{
		Role:      "assistant",
		Content:   "负载正常",
		ModelName: "deepseek-flash",
		Usage:     usage,
	}); err != nil {
		t.Fatalf("AddFullMessage assistant: %v", err)
	}

	history, err := store.GetHistory(ctx, key)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("history length = %d, want 2", len(history))
	}
	if history[1].Usage == nil {
		t.Fatal("assistant usage lost on JSONL round trip")
	}
	if history[1].Usage.PromptTokens != 1200 || history[1].Usage.CompletionTokens != 340 {
		t.Fatalf("assistant usage = %+v, want 1200/340", history[1].Usage)
	}

	transcript := sessionTranscriptMessages(history, 0, false)
	var answered *sessionChatMessage
	for i := range transcript {
		if transcript[i].Role == "assistant" && transcript[i].Usage != nil {
			answered = &transcript[i]
		}
	}
	if answered == nil {
		t.Fatalf("transcript dropped usage: %+v", transcript)
	}

	encoded, err := json.Marshal(answered)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if !strings.Contains(string(encoded), `"usage"`) || !strings.Contains(string(encoded), `"input_tokens":1200`) {
		t.Fatalf("usage not exposed to the panel: %s", encoded)
	}
}

// Messages written before this change must keep serializing without a usage key.
func TestSessionMessageOmitsEmptyUsage(t *testing.T) {
	encoded, err := json.Marshal(sessionChatMessage{Role: "assistant", Content: "hi"})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if strings.Contains(string(encoded), "usage") {
		t.Fatalf("empty usage should be omitted: %s", encoded)
	}
}

// Changed files follow the same path as usage: written by the agent, stored in
// the session JSONL, and served to the panel with the diff attached.
func TestFileChangesSurviveJSONLRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store, err := memory.NewJSONLStore(dir)
	if err != nil {
		t.Fatalf("NewJSONLStore: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	key := "agent:main:pico:direct:pico:changes-test"
	change := providers.FileChange{
		Path:      "/var/lib/picoclaw/workspace/memory/MEMORY.md",
		Diff:      "--- a/memory/MEMORY.md\n+++ b/memory/MEMORY.md\n-old\n+new",
		Additions: 1,
		Deletions: 1,
	}

	if err := store.AddFullMessage(ctx, key, providers.Message{
		Role:        "assistant",
		Content:     "已更新记忆",
		FileChanges: []providers.FileChange{change},
	}); err != nil {
		t.Fatalf("AddFullMessage: %v", err)
	}

	history, err := store.GetHistory(ctx, key)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 1 || len(history[0].FileChanges) != 1 {
		t.Fatalf("file changes lost on round trip: %+v", history)
	}

	transcript := sessionTranscriptMessages(history, 0, false)
	if len(transcript) != 1 {
		t.Fatalf("transcript length = %d, want 1", len(transcript))
	}

	encoded, err := json.Marshal(transcript[0])
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	for _, want := range []string{`"file_changes"`, `"additions":1`, `"deletions":1`, `MEMORY.md`} {
		if !strings.Contains(string(encoded), want) {
			t.Fatalf("transcript JSON missing %s: %s", want, encoded)
		}
	}
}
