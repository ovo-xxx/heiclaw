package agent

import (
	"testing"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/providers"
)

// The final outbound has to carry the turn's accounting: without it the panel only
// saw tokens, money and changed files after re-reading the session, so a fresh
// conversation showed no statistics until it was switched away and back.
func TestMarkFinalOutboundCarriesTurnAccounting(t *testing.T) {
	ts := &turnState{startedAt: time.Now().Add(-2 * time.Second)}
	ts.RecordLLMCall(providers.LLMCallStat{
		Model:  "deepseek-flash",
		Tokens: providers.TurnTokens{InputTokens: 100, OutputTokens: 20, TotalTokens: 120},
	})
	ts.RecordFileChange(&providers.FileChange{Path: "a.md", Diff: "diff", Additions: 1})

	msg := bus.OutboundMessage{}
	markFinalOutbound(ts, &msg)

	if msg.Context.Raw[metadataKeyOutboundKind] != outboundKindFinal {
		t.Fatalf("outbound kind = %q, want final", msg.Context.Raw[metadataKeyOutboundKind])
	}
	if msg.Usage == nil || msg.Usage.CompletionTokens != 20 {
		t.Fatalf("usage = %+v, want the turn's tokens", msg.Usage)
	}
	if msg.Stats == nil || msg.Stats.LLMCallCount != 1 {
		t.Fatalf("stats = %+v, want the turn record", msg.Stats)
	}
	if len(msg.FileChanges) != 1 || msg.FileChanges[0].Path != "a.md" {
		t.Fatalf("file changes = %+v, want the changed file", msg.FileChanges)
	}
}

// A response published outside a turn still gets the final flag, and nothing else.
func TestMarkFinalOutboundWithoutTurnState(t *testing.T) {
	msg := bus.OutboundMessage{}
	markFinalOutbound(nil, &msg)

	if msg.Context.Raw[metadataKeyOutboundKind] != outboundKindFinal {
		t.Fatal("a nil turn state must still mark the message final")
	}
	if msg.Usage != nil || msg.Stats != nil || len(msg.FileChanges) != 0 {
		t.Fatalf("unexpected accounting on a turn-less outbound: %+v", msg)
	}
}
