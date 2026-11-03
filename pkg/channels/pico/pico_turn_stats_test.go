package pico

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"testing"

	"github.com/sipeed/picoclaw/pkg/providers"
)

// turnStatsKeys is the contract the chat panel renders. It is spelled out as a
// literal list here and in web/backend/api/session_usage_test.go on purpose: the
// pico WebSocket payload and the session REST message object must expose exactly
// these snake_case names, so a rename on one side has to be an intentional
// change on both.
func turnStatsKeys() []string {
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

func turnStatsTokensKeys() []string {
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

func jsonKeys(t *testing.T, value any) []string {
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

func sampleTurnStats() *providers.TurnStats {
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
			Index:     0,
			Iteration: 1,
			Model:     "claude-sonnet-4-5",
			Provider:  "claude-cli",
			Tokens:    providers.TurnTokens{InputTokens: 900, OutputTokens: 120, TotalTokens: 1020},
			LatencyMS: 1400,
			Chunks:    24,
		}},
		Tools:        []providers.ToolStat{{Name: "bash", OK: true, DurationMS: 42}},
		ContextUsage: &providers.TurnContextUsage{UsedTokens: 48000, TotalTokens: 200000},
	}
}

func TestSetTurnStatsPayload(t *testing.T) {
	t.Run("attaches the shared struct with the panel keys", func(t *testing.T) {
		payload := map[string]any{PayloadKeyContent: "hi"}
		setTurnStatsPayload(payload, sampleTurnStats())

		raw, ok := payload[PayloadKeyTurnStats]
		if !ok {
			t.Fatalf("expected %q key in payload", PayloadKeyTurnStats)
		}
		if got := jsonKeys(t, raw); !reflect.DeepEqual(got, turnStatsKeys()) {
			t.Fatalf("turn_stats keys = %v, want %v", got, turnStatsKeys())
		}
		stats, ok := raw.(*providers.TurnStats)
		if !ok {
			t.Fatalf("payload carries a copy instead of the shared struct: %T", raw)
		}
		if stats.Tokens.CostUSD != 0.0123 || stats.Tokens.CacheReadTokens != 300 {
			t.Fatalf("cost/cache not surfaced: %+v", stats.Tokens)
		}
		if got := jsonKeys(t, stats.Tokens); !reflect.DeepEqual(got, turnStatsTokensKeys()) {
			t.Fatalf("tokens keys = %v, want %v", got, turnStatsTokensKeys())
		}
	})

	t.Run("omits stats when the turn reported no usage", func(t *testing.T) {
		payload := map[string]any{PayloadKeyContent: "hi"}
		setTurnStatsPayload(payload, nil)
		if _, ok := payload[PayloadKeyTurnStats]; ok {
			t.Errorf("expected no %q key for a nil record", PayloadKeyTurnStats)
		}
	})
}

// A finalized turn carries the record on the created message (the finalize of a
// stream takes the create branch when nothing was visible yet)...
func TestStreamerEmitsTurnStatsOnFinalize(t *testing.T) {
	s, last := newCaptureStreamer()
	s.SetTurnUsage(100, 40)
	s.SetTurnStats(sampleTurnStats())

	s.mu.Lock()
	err := s.sendLocked(context.Background(), "answer", nil)
	s.mu.Unlock()
	if err != nil {
		t.Fatalf("sendLocked: %v", err)
	}
	raw, ok := (*last)[PayloadKeyTurnStats]
	if !ok {
		t.Fatalf("expected turn_stats in the created message payload: %+v", *last)
	}
	if got := jsonKeys(t, raw); !reflect.DeepEqual(got, turnStatsKeys()) {
		t.Fatalf("turn_stats keys = %v, want %v", got, turnStatsKeys())
	}
}

// ...and on the final edit that replaces it. Both branches share one attach
// helper, which is what this pins down.
func TestStreamerAttachesTurnResultPayloadOnBothBranches(t *testing.T) {
	s, _ := newCaptureStreamer()
	s.SetTurnStats(sampleTurnStats())
	s.SetTurnUsage(100, 40)
	s.SetFileChanges([]providers.FileChange{{Path: "a.md", Additions: 1}})

	s.mu.Lock()
	defer s.mu.Unlock()
	createPayload := map[string]any{PayloadKeyContent: "answer"}
	s.attachTurnResultPayload(createPayload)
	for _, key := range []string{PayloadKeyUsage, PayloadKeyFileChanges, PayloadKeyTurnStats} {
		if _, ok := createPayload[key]; !ok {
			t.Fatalf("attach helper dropped %q: %+v", key, createPayload)
		}
	}
}
