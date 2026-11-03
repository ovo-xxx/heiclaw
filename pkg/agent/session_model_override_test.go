package agent

import (
	"testing"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/providers"
	"github.com/sipeed/picoclaw/pkg/session"
)

// fakeSessionModelStore implements the metadata-aware surface the turn setup
// reads, and records every write so persistence can be asserted.
type fakeSessionModelStore struct {
	session.SessionStore
	model string
	sets  []string
}

func (f *fakeSessionModelStore) GetSessionModel(string) string { return f.model }

func (f *fakeSessionModelStore) SetSessionModel(_ string, model string) {
	f.model = model
	f.sets = append(f.sets, model)
}

func (f *fakeSessionModelStore) EnsureSessionMetadata(string, *session.SessionScope, []string) {
}

func (f *fakeSessionModelStore) ResolveSessionKey(key string) string { return key }

func (f *fakeSessionModelStore) GetSessionScope(string) *session.SessionScope { return nil }

func newPinnedModelFixture(t *testing.T, storedModel string) (*Pipeline, *turnState, *turnExecution, *fakeSessionModelStore) {
	t.Helper()

	cfg := &config.Config{
		Agents: config.AgentsConfig{Defaults: config.AgentDefaults{Provider: "openai"}},
		ModelList: []*config.ModelConfig{{
			ModelName: "pinned-model",
			Provider:  "anthropic",
			Model:     "claude-sonnet",
			APIKeys:   config.SimpleSecureStrings("sk-ant-test"),
		}},
	}
	candidate, ok := resolveModelCandidate(cfg, "openai", "pinned-model")
	if !ok {
		t.Fatal("resolveModelCandidate() did not resolve pinned model")
	}

	store := &fakeSessionModelStore{model: storedModel}
	pinned := &mockProvider{}
	agent := &AgentInstance{
		Workspace: t.TempDir(),
		Sessions:  store,
		Model:     "default-model",
		Provider:  &mockProvider{},
		CandidateProviders: map[string]providers.LLMProvider{
			candidateProviderKey(candidate): pinned,
		},
	}
	exec := &turnExecution{
		activeModel:      "default-model",
		llmModelName:     "default-model",
		activeProvider:   agent.Provider,
		activeCandidates: []providers.FallbackCandidate{{Provider: "openai", Model: "default-model"}},
	}
	ts := &turnState{agent: agent, sessionKey: "agent:main:pico:direct:pico:s1"}

	return &Pipeline{Cfg: cfg}, ts, exec, store
}

func TestApplySessionModelOverridePinsFromMessageAndPersists(t *testing.T) {
	pipeline, ts, exec, store := newPinnedModelFixture(t, "")
	ts.opts.ModelOverride = "pinned-model"

	pipeline.applySessionModelOverride(ts, exec)

	if exec.activeModel != "claude-sonnet" {
		t.Fatalf("active model = %q, want %q", exec.activeModel, "claude-sonnet")
	}
	if exec.llmModelName != "claude-sonnet" {
		t.Fatalf("llmModelName = %q, want the resolved model to reach the turn record", exec.llmModelName)
	}
	if len(store.sets) != 1 || store.sets[0] != "pinned-model" {
		t.Fatalf("persisted pins = %v, want exactly one write of %q", store.sets, "pinned-model")
	}
}

func TestApplySessionModelOverrideUsesStoredPinWithoutMessageField(t *testing.T) {
	pipeline, ts, exec, store := newPinnedModelFixture(t, "pinned-model")

	pipeline.applySessionModelOverride(ts, exec)

	if exec.activeModel != "claude-sonnet" {
		t.Fatalf("active model = %q, want the stored pin to apply", exec.activeModel)
	}
	if len(store.sets) != 0 {
		t.Fatalf("persisted pins = %v, want no rewrite when the message carries no pin", store.sets)
	}
}

func TestApplySessionModelOverrideClearsStoredPinWhenFieldIsEmpty(t *testing.T) {
	pipeline, ts, exec, store := newPinnedModelFixture(t, "pinned-model")
	ts.opts.ModelOverride = ""
	ts.opts.ModelOverrideSet = true

	pipeline.applySessionModelOverride(ts, exec)

	if exec.activeModel != "default-model" {
		t.Fatalf("active model = %q, want the agent model after clearing the pin", exec.activeModel)
	}
	if len(store.sets) != 1 || store.sets[0] != "" {
		t.Fatalf("persisted pins = %v, want exactly one write of %q", store.sets, "")
	}
}

func TestApplySessionModelOverrideKeepsAgentModelWhenPinIsUnresolvable(t *testing.T) {
	pipeline, ts, exec, store := newPinnedModelFixture(t, "")
	ts.opts.ModelOverride = "model-not-in-config"

	pipeline.applySessionModelOverride(ts, exec)

	if exec.activeModel != "default-model" {
		t.Fatalf("active model = %q, want the agent model to stand", exec.activeModel)
	}
	if exec.llmModelName != "default-model" {
		t.Fatalf("llmModelName = %q, want the agent model to stand", exec.llmModelName)
	}
	if len(store.sets) != 0 {
		t.Fatalf("persisted pins = %v, want a rejected pin to stay unpersisted", store.sets)
	}
}

func TestApplySessionModelOverrideSkipsStoreWithoutModelSupport(t *testing.T) {
	pipeline, ts, exec, _ := newPinnedModelFixture(t, "pinned-model")
	ts.agent.Sessions = &sessionOnlyStub{}
	ts.opts.ModelOverride = "pinned-model"

	pipeline.applySessionModelOverride(ts, exec)

	if exec.activeModel != "default-model" {
		t.Fatalf("active model = %q, want no change when the store has no model support", exec.activeModel)
	}
}

// sessionOnlyStub satisfies session.SessionStore without metadata support.
type sessionOnlyStub struct{ session.SessionStore }
