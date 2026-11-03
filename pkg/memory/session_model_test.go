package memory

import (
	"context"
	"encoding/json"
	"testing"
)

func TestSetSessionModelRoundTrip(t *testing.T) {
	store, err := NewJSONLStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewJSONLStore() error = %v", err)
	}
	ctx := context.Background()
	key := "agent:main:pico:direct:pico:s1"

	if got := mustMeta(t, store, ctx, key).Model; got != "" {
		t.Fatalf("initial model = %q, want empty", got)
	}

	if err := store.SetSessionModel(ctx, key, "  deepseek-chat  "); err != nil {
		t.Fatalf("SetSessionModel() error = %v", err)
	}
	if got := mustMeta(t, store, ctx, key).Model; got != "deepseek-chat" {
		t.Fatalf("model = %q, want %q", got, "deepseek-chat")
	}

	// An unrelated metadata upsert must not drop the pin.
	scope := json.RawMessage(`{"channel":"pico"}`)
	if err := store.UpsertSessionMeta(ctx, key, scope, []string{"alias-1"}); err != nil {
		t.Fatalf("UpsertSessionMeta() error = %v", err)
	}
	if got := mustMeta(t, store, ctx, key).Model; got != "deepseek-chat" {
		t.Fatalf("model after scope upsert = %q, want the pin to survive", got)
	}

	if err := store.SetSessionModel(ctx, key, ""); err != nil {
		t.Fatalf("SetSessionModel(clear) error = %v", err)
	}
	meta := mustMeta(t, store, ctx, key)
	if meta.Model != "" {
		t.Fatalf("model after clear = %q, want empty", meta.Model)
	}
	var scopeBack map[string]string
	if err := json.Unmarshal(meta.Scope, &scopeBack); err != nil {
		t.Fatalf("decode scope %s: %v", meta.Scope, err)
	}
	if scopeBack["channel"] != "pico" {
		t.Fatalf("scope = %s, want it preserved while clearing the model", meta.Scope)
	}
}

func mustMeta(t *testing.T, store *JSONLStore, ctx context.Context, key string) SessionMeta {
	t.Helper()
	meta, err := store.GetSessionMeta(ctx, key)
	if err != nil {
		t.Fatalf("GetSessionMeta() error = %v", err)
	}
	return meta
}
