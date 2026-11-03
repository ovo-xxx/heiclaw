package api

import (
	"context"
	"encoding/json"
	"sort"
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

// sessionTurnStatsKeys is the same literal contract the pico WebSocket test
// pins: one shape for "just streamed" and "loaded from history".
func sessionTurnStatsKeys() []string {
	return []string{
		"context_usage",
		"dropped_llm_call_count",
		"dropped_tool_count",
		"duration_ms",
		"finish_reason",
		"llm_call_count",
		"llm_calls",
		"stream_chunks",
		"time_to_first_token_ms",
		"tokens",
		"tool_iterations",
		"tools",
	}
}

func sessionTurnStatsTokensKeys() []string {
	return []string{
		"cache_creation_tokens",
		"cache_read_tokens",
		"cost_usd",
		"input_tokens",
		"output_tokens",
		"reasoning_tokens",
		"total_tokens",
	}
}

func sessionJSONKeys(t *testing.T, value any) []string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	keys := make([]string, 0, len(decoded))
	for key := range decoded {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sessionSampleTurnStats() *providers.TurnStats {
	return &providers.TurnStats{
		DurationMS:          8321,
		TimeToFirstTokenMS:  912,
		FinishReason:        "stop",
		LLMCallCount:        2,
		ToolIterations:      2,
		StreamChunks:        41,
		DroppedLLMCallCount: 1,
		DroppedToolCount:    1,
		Tokens: providers.TurnTokens{
			InputTokens:         2000,
			OutputTokens:        320,
			TotalTokens:         2320,
			CacheReadTokens:     300,
			CacheCreationTokens: 80,
			ReasoningTokens:     60,
			CostUSD:             0.0123,
		},
		LLMCalls: []providers.LLMCallStat{{
			Index:      0,
			Iteration:  1,
			Model:      "claude-sonnet-4-5",
			Provider:   "claude-cli",
			Tokens:     providers.TurnTokens{InputTokens: 900, OutputTokens: 120, TotalTokens: 1020},
			LatencyMS:  1400,
			Chunks:     24,
		}},
		Tools:        []providers.ToolStat{{Name: "bash", OK: true, DurationMS: 42}},
		ContextUsage: &providers.TurnContextUsage{UsedTokens: 48000, TotalTokens: 200000, CompressAtTokens: 192000},
	}
}

// Detailed turn performance stats take the same spine as file_changes: the agent
// writes them into the assistant message, pkg/memory keeps them, and the session
// API serves them under the identical keys the WebSocket used.
func TestTurnStatsSurviveJSONLRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store, err := memory.NewJSONLStore(dir)
	if err != nil {
		t.Fatalf("NewJSONLStore: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	key := "agent:main:pico:direct:pico:stats-test"
	stats := sessionSampleTurnStats()

	if err := store.AddFullMessage(ctx, key, providers.Message{
		Role:      "assistant",
		Content:   "跑完了",
		ModelName: "claude-sonnet-4-5",
		Usage:     &providers.UsageInfo{PromptTokens: 2000, CompletionTokens: 320, TotalTokens: 2320},
		Stats:     stats,
	}); err != nil {
		t.Fatalf("AddFullMessage: %v", err)
	}

	history, err := store.GetHistory(ctx, key)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 1 || history[0].Stats == nil {
		t.Fatalf("turn_stats lost on JSONL round trip: %+v", history)
	}
	if history[0].Stats.Tokens.CostUSD != 0.0123 || len(history[0].Stats.LLMCalls) != 1 {
		t.Fatalf("stats truncated: %+v", history[0].Stats)
	}

	transcript := sessionTranscriptMessages(history, 0, false)
	if len(transcript) != 1 {
		t.Fatalf("transcript length = %d, want 1", len(transcript))
	}
	if transcript[0].Stats != history[0].Stats {
		t.Fatal("session API copied the stats instead of passing the shared struct through")
	}

	encoded, err := json.Marshal(transcript[0])
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var decoded struct {
		TurnStats map[string]any `json:"turn_stats"`
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("Unmarshal transcript: %v", err)
	}
	if decoded.TurnStats == nil {
		t.Fatalf("turn_stats missing from the REST message: %s", encoded)
	}
	keys := make([]string, 0, len(decoded.TurnStats))
	for k := range decoded.TurnStats {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != strings.Join(sessionTurnStatsKeys(), ",") {
		t.Fatalf("turn_stats keys = %v, want %v", keys, sessionTurnStatsKeys())
	}
	if got := sessionJSONKeys(t, transcript[0].Stats.Tokens); strings.Join(got, ",") != strings.Join(sessionTurnStatsTokensKeys(), ",") {
		t.Fatalf("tokens keys = %v, want %v", got, sessionTurnStatsTokensKeys())
	}
	if transcript[0].Usage == nil || transcript[0].Usage.InputTokens != 2000 {
		t.Fatalf("the compact usage block regressed: %+v", transcript[0].Usage)
	}
}

// History written before the stats existed must decode with no stats and serve
// without the key, not as an error and not as an empty object.
func TestSessionMessageOmitsAbsentTurnStats(t *testing.T) {
	dir := t.TempDir()
	store, err := memory.NewJSONLStore(dir)
	if err != nil {
		t.Fatalf("NewJSONLStore: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	key := "agent:main:pico:direct:pico:no-stats-test"
	if err := store.AddFullMessage(ctx, key, providers.Message{
		Role:    "assistant",
		Content: "旧会话",
	}); err != nil {
		t.Fatalf("AddFullMessage: %v", err)
	}
	history, err := store.GetHistory(ctx, key)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if history[0].Stats != nil {
		t.Fatalf("old JSONL decoded a stats object: %+v", history[0].Stats)
	}
	transcript := sessionTranscriptMessages(history, 0, false)
	if len(transcript) != 1 {
		t.Fatalf("transcript length = %d, want 1", len(transcript))
	}
	encoded, err := json.Marshal(transcript[0])
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if strings.Contains(string(encoded), "turn_stats") {
		t.Fatalf("absent stats should be omitted: %s", encoded)
	}
}
