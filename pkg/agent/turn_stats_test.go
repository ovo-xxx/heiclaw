package agent

import (
	"testing"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/providers"
)

// A turn with two LLM calls and one tool run has to report the summed tokens,
// both per-call entries and a server-side duration. This is the shape the panel
// renders under the assistant bubble.
func TestTurnStatsTwoCallsOneTool(t *testing.T) {
	ts := &turnState{startedAt: time.Now().Add(-150 * time.Millisecond)}
	ts.setIteration(2)
	ts.SetLastFinishReason("stop")

	ts.RecordLLMCall(providers.LLMCallStat{
		Iteration:    1,
		Model:        "claude-sonnet-4-5",
		Provider:     "claude-cli",
		FinishReason: "tool_calls",
		Tokens: providers.TurnTokens{
			InputTokens:         900,
			OutputTokens:        120,
			TotalTokens:         1400,
			CacheReadTokens:     300,
			CacheCreationTokens: 80,
		},
		LatencyMS: 1400,
		TTFTMS:    210,
		Chunks:    24,
		ToolCalls: 1,
	})
	ts.RecordLLMCall(providers.LLMCallStat{
		Iteration:       2,
		Model:           "claude-sonnet-4-5",
		Provider:        "claude-cli",
		FinishReason:    "stop",
		Tokens:          providers.TurnTokens{InputTokens: 1100, OutputTokens: 200, TotalTokens: 1300, ReasoningTokens: 60},
		LatencyMS:       2200,
		RetryAttempt:    2,
		FallbackAttempt: 1,
	})
	ts.recordToolExecution("edit_file", true, "", nil, 42)
	ts.RecordStreamChunkTiming(time.Now().Add(-100 * time.Millisecond))

	usage := ts.GetTurnUsage()
	if usage == nil {
		t.Fatal("GetTurnUsage() = nil, want the summed usage of both calls")
	}
	if usage.PromptTokens != 2000 || usage.CompletionTokens != 320 || usage.TotalTokens != 2700 {
		t.Fatalf("turn usage = %+v, want 2000/320/2700", usage)
	}

	stats := ts.GetTurnStats(&bus.ContextUsage{
		UsedTokens:       48000,
		TotalTokens:      200000,
		HistoryTokens:    40000,
		CompressAtTokens: 192000,
		UsedPercent:      25,
	})
	if stats == nil {
		t.Fatal("GetTurnStats() = nil")
	}

	if stats.LLMCallCount != 2 || stats.ToolIterations != 2 || stats.FinishReason != "stop" {
		t.Fatalf("counters = %+v", stats)
	}
	if stats.StreamChunks != 24 {
		t.Fatalf("stream chunks = %d, want 24", stats.StreamChunks)
	}
	if stats.Tokens != (providers.TurnTokens{
		InputTokens:         2000,
		OutputTokens:        320,
		TotalTokens:         2700,
		CacheReadTokens:     300,
		CacheCreationTokens: 80,
		ReasoningTokens:     60,
	}) {
		t.Fatalf("tokens = %+v", stats.Tokens)
	}
	if stats.DurationMS < 100 {
		t.Fatalf("duration_ms = %d, want the server-side turn span", stats.DurationMS)
	}
	// startedAt is 150ms back and the first chunk 100ms back, so the span is a
	// deterministic 50ms.
	if stats.TimeToFirstTokenMS != 50 {
		t.Fatalf("time_to_first_token_ms = %d, want 50", stats.TimeToFirstTokenMS)
	}

	if len(stats.LLMCalls) != 2 {
		t.Fatalf("llm_calls = %+v, want 2 entries", stats.LLMCalls)
	}
	first, second := stats.LLMCalls[0], stats.LLMCalls[1]
	if first.Index != 0 || second.Index != 1 {
		t.Fatalf("call indexes = %d, %d; want 0, 1", first.Index, second.Index)
	}
	if first.Provider != "claude-cli" || first.Model != "claude-sonnet-4-5" || first.Chunks != 24 {
		t.Fatalf("first call = %+v", first)
	}
	if second.RetryAttempt != 2 || second.FallbackAttempt != 1 {
		t.Fatalf("second call attempts = %+v", second)
	}

	if len(stats.Tools) != 1 || stats.Tools[0].Name != "edit_file" || !stats.Tools[0].OK ||
		stats.Tools[0].DurationMS != 42 {
		t.Fatalf("tools = %+v, want edit_file ok 42ms", stats.Tools)
	}
	if stats.ContextUsage == nil || stats.ContextUsage.UsedTokens != 48000 ||
		stats.ContextUsage.CompressAtTokens != 192000 {
		t.Fatalf("context usage = %+v", stats.ContextUsage)
	}

	// The stats object is cached, so the JSONL record and the WebSocket payload
	// describe the very same numbers instead of two snapshots taken moments
	// apart.
	again := ts.GetTurnStats(nil)
	if again != stats {
		t.Fatal("GetTurnStats() rebuilt the record; JSONL and WS would disagree")
	}
}

// Tool durations reach the turn record through the same recorder the runtime
// events use.
func TestRecordToolExecutionKeepsDuration(t *testing.T) {
	ts := &turnState{}
	ts.recordToolExecution("message", true, "", nil, 7)
	ts.recordToolExecution("read_file", false, "boom", nil, 1200)

	records := ts.toolExecutionsSnapshot()
	if len(records) != 2 || records[0].DurationMS != 7 || records[1].DurationMS != 1200 {
		t.Fatalf("records = %+v", records)
	}
	stats := ts.GetTurnStats(nil)
	if stats != nil {
		t.Fatalf("a turn that never called the LLM must not produce stats: %+v", stats)
	}
}

// Session JSONL lines are size-capped, so the per-call list stops growing while
// the totals keep counting.
func TestTurnStatsCapsPerCallListAndCountsDrops(t *testing.T) {
	ts := &turnState{}
	for i := 0; i < maxRecordedLLMCalls+5; i++ {
		ts.RecordLLMCall(providers.LLMCallStat{
			Tokens: providers.TurnTokens{InputTokens: 10, OutputTokens: 5, TotalTokens: 15},
		})
	}
	for i := 0; i < maxRecordedToolStats+3; i++ {
		ts.recordToolExecution("bash", true, "", nil, 1)
	}

	stats := ts.GetTurnStats(nil)
	if stats == nil {
		t.Fatal("GetTurnStats() = nil")
	}
	if stats.LLMCallCount != maxRecordedLLMCalls+5 {
		t.Fatalf("llm_call_count = %d, want every call counted", stats.LLMCallCount)
	}
	if len(stats.LLMCalls) != maxRecordedLLMCalls {
		t.Fatalf("listed calls = %d, want the cap %d", len(stats.LLMCalls), maxRecordedLLMCalls)
	}
	if stats.DroppedLLMCallCount != 5 {
		t.Fatalf("dropped_llm_call_count = %d, want 5", stats.DroppedLLMCallCount)
	}
	if stats.Tokens.InputTokens != (maxRecordedLLMCalls+5)*10 {
		t.Fatalf("totals dropped skipped calls: %+v", stats.Tokens)
	}
	if len(stats.Tools) != maxRecordedToolStats || stats.DroppedToolCount != 3 {
		t.Fatalf("tools = %d listed, %d dropped; want %d listed, 3 dropped",
			len(stats.Tools), stats.DroppedToolCount, maxRecordedToolStats)
	}
}
