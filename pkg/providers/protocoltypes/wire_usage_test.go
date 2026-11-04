package protocoltypes

import (
	"encoding/json"
	"testing"
)

// DeepSeek bills a cache hit at 2% (flash, off-peak) of what it bills fresh input,
// and it reports the hit *inside* prompt_tokens. Decoding that straight into
// UsageInfo would price the cached 90k as if it were fresh, so the wire shape has
// to be widened and split before anything downstream reads the dimensions.
func TestWireUsageSplitsCachedInputOutOfPromptTokens(t *testing.T) {
	const payload = `{
		"prompt_tokens": 91000,
		"completion_tokens": 500,
		"total_tokens": 91500,
		"prompt_cache_hit_tokens": 90000,
		"prompt_cache_miss_tokens": 1000
	}`
	var wire WireUsage
	if err := json.Unmarshal([]byte(payload), &wire); err != nil {
		t.Fatalf("decode: %v", err)
	}
	usage := wire.Resolve()
	if usage.PromptTokens != 1000 {
		t.Errorf("prompt_tokens = %d, want the uncached 1000", usage.PromptTokens)
	}
	if usage.CacheReadTokens != 90000 {
		t.Errorf("cache_read_tokens = %d, want 90000", usage.CacheReadTokens)
	}
	if usage.CompletionTokens != 500 || usage.TotalTokens != 91500 {
		t.Errorf("completion/total = %d/%d, want 500/91500", usage.CompletionTokens, usage.TotalTokens)
	}

	// The invariant every adapter shares has to hold after the split, because the
	// price table and the context budget both read it.
	if usage.TotalTokens != usage.PromptTokens+usage.CacheReadTokens+usage.CacheCreationTokens+usage.CompletionTokens {
		t.Errorf("invariant broken: %+v", usage)
	}
}

func TestWireUsageLeavesPlainPayloadsAlone(t *testing.T) {
	var wire WireUsage
	if err := json.Unmarshal([]byte(`{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150}`), &wire); err != nil {
		t.Fatalf("decode: %v", err)
	}
	usage := wire.Resolve()
	if usage.PromptTokens != 120 || usage.CacheReadTokens != 0 {
		t.Errorf("usage = %+v, want the payload unchanged", usage)
	}
}

// A provider that reports the hit total but no miss breakdown still has to lose the
// cached part from prompt_tokens, or the same tokens get counted twice.
func TestWireUsageDerivesMissFromPromptTokens(t *testing.T) {
	var wire WireUsage
	if err := json.Unmarshal([]byte(`{"prompt_tokens":91000,"completion_tokens":10,"prompt_cache_hit_tokens":90000}`), &wire); err != nil {
		t.Fatalf("decode: %v", err)
	}
	usage := wire.Resolve()
	if usage.PromptTokens != 1000 || usage.CacheReadTokens != 90000 {
		t.Errorf("usage = %+v, want 1000 fresh + 90000 cached", usage)
	}
}

func TestWireUsageNilIsNoUsage(t *testing.T) {
	var wire *WireUsage
	if wire.Resolve() != nil {
		t.Error("Resolve on a missing usage object must stay nil")
	}
}
