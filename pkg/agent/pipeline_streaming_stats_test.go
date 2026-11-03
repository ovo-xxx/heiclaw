package agent

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/providers"
)

// statsCapturingStreamer stands in for the pico streamer: it records what the
// streaming publisher attaches before the final message goes out.
type statsCapturingStreamer struct {
	mu           sync.Mutex
	usageIn      int
	usageOut     int
	fileChanges  []providers.FileChange
	stats        *providers.TurnStats
	finalContent string
}

func (s *statsCapturingStreamer) Update(context.Context, string) error { return nil }

func (s *statsCapturingStreamer) Finalize(_ context.Context, content string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finalContent = content
	return nil
}

func (s *statsCapturingStreamer) Cancel(context.Context) {}

func (s *statsCapturingStreamer) SetTurnUsage(inputTokens, outputTokens int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.usageIn = inputTokens
	s.usageOut = outputTokens
}

func (s *statsCapturingStreamer) SetFileChanges(changes []providers.FileChange) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.fileChanges = changes
}

func (s *statsCapturingStreamer) SetTurnStats(stats *providers.TurnStats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stats = stats
}

// The streamed turn and the persisted JSONL record must be the same object, not
// two snapshots: the panel shows one contract for live and replayed turns.
func TestStreamingPublisherFinalizeAttachesTurnStats(t *testing.T) {
	ts := &turnState{
		agent:     &AgentInstance{ID: "main"},
		channel:   "pico",
		chatID:    "chat-1",
		startedAt: time.Now().Add(-30 * time.Millisecond),
	}
	ts.setIteration(2)
	ts.SetLastFinishReason("stop")
	ts.RecordLLMCall(providers.LLMCallStat{
		Iteration: 1,
		Model:     "gpt-5",
		Provider:  "openrouter",
		Tokens:    providers.TurnTokens{InputTokens: 800, OutputTokens: 90, TotalTokens: 890},
		LatencyMS: 900,
	})

	streamer := &statsCapturingStreamer{}
	publisher := &streamingChunkPublisher{
		streamer:  streamer,
		channel:   "pico",
		chatID:    "chat-1",
		modelName: "gpt-5",
		ts:        ts,
	}
	contextUsage := &bus.ContextUsage{UsedTokens: 1200, TotalTokens: 8000, CompressAtTokens: 7000}

	if err := publisher.Finalize(context.Background(), "done", contextUsage); err != nil {
		t.Fatalf("publisher.Finalize: %v", err)
	}
	if streamer.finalContent != "done" {
		t.Fatalf("finalized content = %q", streamer.finalContent)
	}
	if streamer.usageIn != 800 || streamer.usageOut != 90 {
		t.Fatalf("usage = %d/%d, want 800/90", streamer.usageIn, streamer.usageOut)
	}
	if streamer.stats == nil {
		t.Fatal("turn stats were not attached to the streamer")
	}
	if streamer.stats.LLMCallCount != 1 || streamer.stats.ToolIterations != 2 {
		t.Fatalf("stats = %+v", streamer.stats)
	}
	if streamer.stats.ContextUsage == nil || streamer.stats.ContextUsage.CompressAtTokens != 7000 {
		t.Fatalf("context usage not attached: %+v", streamer.stats.ContextUsage)
	}
	if streamer.stats != ts.GetTurnStats(contextUsage) {
		t.Fatal("publisher sent a different record than the turn caches")
	}
}

// A turn that never produced usage must not grow a stats object on the wire.
func TestStreamingPublisherSkipsEmptyTurnStats(t *testing.T) {
	ts := &turnState{agent: &AgentInstance{ID: "main"}, channel: "pico", chatID: "c", startedAt: time.Now()}
	streamer := &statsCapturingStreamer{}
	publisher := &streamingChunkPublisher{streamer: streamer, channel: "pico", chatID: "c", ts: ts}

	if err := publisher.Finalize(context.Background(), "done", nil); err != nil {
		t.Fatalf("publisher.Finalize: %v", err)
	}
	if streamer.stats != nil {
		t.Fatalf("empty turn produced stats: %+v", streamer.stats)
	}
}
