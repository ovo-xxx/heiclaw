package protocoltypes

import "time"

type ToolCall struct {
	ID               string         `json:"id"`
	Type             string         `json:"type,omitempty"`
	Function         *FunctionCall  `json:"function,omitempty"`
	Name             string         `json:"-"`
	Arguments        map[string]any `json:"-"`
	ThoughtSignature string         `json:"-"` // Internal use only
	ExtraContent     *ExtraContent  `json:"extra_content,omitempty"`
}

type ExtraContent struct {
	Google                  *GoogleExtra `json:"google,omitempty"`
	ToolFeedbackExplanation string       `json:"tool_feedback_explanation,omitempty"`
}

type GoogleExtra struct {
	ThoughtSignature string `json:"thought_signature,omitempty"`
}

type FunctionCall struct {
	Name             string `json:"name"`
	Arguments        string `json:"arguments"`
	ThoughtSignature string `json:"thought_signature,omitempty"`
}

type LLMResponse struct {
	Content          string            `json:"content"`
	ReasoningContent string            `json:"reasoning_content,omitempty"`
	ToolCalls        []ToolCall        `json:"tool_calls,omitempty"`
	FinishReason     string            `json:"finish_reason"`
	Usage            *UsageInfo        `json:"usage,omitempty"`
	Reasoning        string            `json:"reasoning"`
	ReasoningDetails []ReasoningDetail `json:"reasoning_details"`
}

type StreamChunk struct {
	Content          string
	ReasoningContent string
}

type ReasoningDetail struct {
	Format string `json:"format"`
	Index  int    `json:"index"`
	Type   string `json:"type"`
	Text   string `json:"text"`
}

// UsageInfo is the per-LLM-call token accounting reported by a provider.
//
// Token convention shared by every provider adapter: cached input is billed
// apart from fresh input, so the input dimensions are additive and
//
//	TotalTokens == PromptTokens + CacheReadTokens + CacheCreationTokens + CompletionTokens
//
// Adapters whose wire format reports cached tokens as a subset of the input
// total (OpenAI Responses) subtract that subset from PromptTokens so the
// invariant keeps holding. ReasoningTokens is a breakdown of CompletionTokens
// (a subset, never additive). CostUSD is only set by adapters that price the
// call themselves; providers that do not report a dimension leave it at zero.
type UsageInfo struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`

	// CacheReadTokens is input served from a prompt cache; CacheCreationTokens
	// is input written into one. Both are additional to PromptTokens.
	CacheReadTokens     int     `json:"cache_read_tokens,omitempty"`
	CacheCreationTokens int     `json:"cache_creation_tokens,omitempty"`
	ReasoningTokens     int     `json:"reasoning_tokens,omitempty"`
	CostUSD             float64 `json:"cost_usd,omitempty"`
}

// TurnTokens is the summed usage of every LLM call in one turn, spelled with the
// names the panel reads (input/output rather than prompt/completion). Same
// additivity rules as UsageInfo: ReasoningTokens is a subset of OutputTokens.
type TurnTokens struct {
	InputTokens         int     `json:"input_tokens"`
	OutputTokens        int     `json:"output_tokens"`
	TotalTokens         int     `json:"total_tokens"`
	CacheReadTokens     int     `json:"cache_read_tokens,omitempty"`
	CacheCreationTokens int     `json:"cache_creation_tokens,omitempty"`
	ReasoningTokens     int     `json:"reasoning_tokens,omitempty"`
	CostUSD             float64 `json:"cost_usd,omitempty"`
}

// AsTurnTokens spells one call's usage with the panel-facing names. A nil
// receiver (a provider that reported no usage at all) yields zeros.
func (u *UsageInfo) AsTurnTokens() TurnTokens {
	if u == nil {
		return TurnTokens{}
	}
	return TurnTokens{
		InputTokens:         u.PromptTokens,
		OutputTokens:        u.CompletionTokens,
		TotalTokens:         u.TotalTokens,
		CacheReadTokens:     u.CacheReadTokens,
		CacheCreationTokens: u.CacheCreationTokens,
		ReasoningTokens:     u.ReasoningTokens,
		CostUSD:             u.CostUSD,
	}
}

// Add folds another call's tokens into this running turn total.
func (t *TurnTokens) Add(other TurnTokens) {
	t.InputTokens += other.InputTokens
	t.OutputTokens += other.OutputTokens
	t.TotalTokens += other.TotalTokens
	t.CacheReadTokens += other.CacheReadTokens
	t.CacheCreationTokens += other.CacheCreationTokens
	t.ReasoningTokens += other.ReasoningTokens
	t.CostUSD += other.CostUSD
}

// IsZero reports whether no token at all was accounted for.
func (t TurnTokens) IsZero() bool {
	return t.InputTokens == 0 && t.OutputTokens == 0 && t.TotalTokens == 0 &&
		t.CacheReadTokens == 0 && t.CacheCreationTokens == 0 && t.ReasoningTokens == 0 && t.CostUSD == 0
}

// WireUsage widens UsageInfo for the OpenAI-compatible wire format, where some
// providers (DeepSeek) report the cached part of the input *inside* prompt_tokens
// instead of as a separate dimension:
//
//	prompt_tokens == prompt_cache_hit_tokens + prompt_cache_miss_tokens
//
// UsageInfo's convention bills cached input apart from fresh input, so decoding
// straight into it would read a cache hit as ordinary input and price it four to
// fifty times too high. Resolve() applies the split.
type WireUsage struct {
	UsageInfo
	PromptCacheHitTokens  int `json:"prompt_cache_hit_tokens"`
	PromptCacheMissTokens int `json:"prompt_cache_miss_tokens"`
}

// Resolve returns the usage spelled with UsageInfo's dimensions. A payload with no
// cache categories is returned as it arrived, so providers that report nothing
// about caching keep their existing shape.
func (w *WireUsage) Resolve() *UsageInfo {
	if w == nil {
		return nil
	}
	usage := w.UsageInfo
	hit := w.PromptCacheHitTokens
	if hit <= 0 {
		return &usage
	}
	usage.CacheReadTokens = hit
	switch {
	case w.PromptCacheMissTokens > 0:
		usage.PromptTokens = w.PromptCacheMissTokens
	case usage.PromptTokens >= hit:
		usage.PromptTokens -= hit
	}
	return &usage
}

// LLMCallStat is one completed LLM call inside a turn. A turn that loops over
// tools makes several calls, so the turn total is not any single entry here.
type LLMCallStat struct {
	Index        int    `json:"index"`
	Iteration    int    `json:"iteration,omitempty"`
	Model        string `json:"model,omitempty"`
	Provider     string `json:"provider,omitempty"`
	FinishReason string `json:"finish_reason,omitempty"`

	Tokens    TurnTokens `json:"tokens"`
	LatencyMS int64      `json:"latency_ms"`

	// TTFTMS is time from the start of this call to its first streamed chunk;
	// zero for non-streamed calls. Chunks counts the streamed chunks.
	TTFTMS int64 `json:"time_to_first_token_ms,omitempty"`
	Chunks int   `json:"stream_chunks,omitempty"`

	// StreamedFallback marks a call whose stream failed and was re-issued as a
	// plain completion. RetryAttempt is the 1-based retry number of the attempt
	// that finally succeeded (0 = first try), and FallbackAttempt the 1-based
	// index within the configured fallback chain (0 = primary candidate).
	StreamedFallback bool `json:"streamed_fallback,omitempty"`
	RetryAttempt     int  `json:"retry_attempt,omitempty"`
	FallbackAttempt  int  `json:"fallback_attempt,omitempty"`
	ToolCalls        int  `json:"tool_calls,omitempty"`
	ContentChars     int  `json:"content_chars,omitempty"`

	// StartedAtMS is when this call began, in unix milliseconds. The money a call
	// costs depends on the hour (DeepSeek prices peak and off-peak differently),
	// and a turn can straddle a boundary, so the band is decided per call.
	StartedAtMS int64 `json:"started_at_ms,omitempty"`
	// Cost is what this call cost under the provider's published price table.
	// Absent for models no table covers, rather than a zero that reads as free.
	Cost *CallCost `json:"cost,omitempty"`
}

// CallCost is the priced breakdown of one LLM call. The token categories are
// priced separately and the peak band doubles the rate, so the split travels with
// the total: a reader can check the number against the published table.
type CallCost struct {
	Currency  string  `json:"currency"`
	Amount    float64 `json:"amount"`
	Input     float64 `json:"input"`
	CacheRead float64 `json:"cache_read"`
	Output    float64 `json:"output"`
	Peak      bool    `json:"peak"`

	// The per-million prices the amount was computed with. Without them the panel
	// could only show a number and ask the user to trust it.
	InputRate     float64 `json:"input_rate"`
	CacheReadRate float64 `json:"cache_read_rate"`
	OutputRate    float64 `json:"output_rate"`

	// Table names the price row used, so the panel can say which table and how
	// old it is.
	Table  string `json:"table,omitempty"`
	Source string `json:"source,omitempty"`

	// Custom marks rates that came from the model entry rather than from the row.
	// The panel says 自定义价目 instead of showing the row's source line.
	Custom bool `json:"custom,omitempty"`
}

// TurnCost is the summed call cost of a turn. Calls priced in different currencies
// are not added together, so the total only appears when one currency covers the
// turn; the per-call numbers stay in llm_calls either way.
type TurnCost struct {
	Currency     string  `json:"currency"`
	Amount       float64 `json:"amount"`
	PeakCalls    int     `json:"peak_calls,omitempty"`
	OffPeakCalls int     `json:"off_peak_calls,omitempty"`
	CoveredCalls int     `json:"covered_calls"`
	Uncounted    int     `json:"uncounted_calls,omitempty"`
	Table        string  `json:"table,omitempty"`
}

// ToolStat is one tool run of the turn. Kept deliberately small: session JSONL
// is append-only and read with a per-line cap, so no output or diffs belong here.
type ToolStat struct {
	Name       string `json:"name"`
	OK         bool   `json:"ok"`
	DurationMS int64  `json:"duration_ms"`
	// CallID matches this stat to one tool call in the message, so the panel can
	// print a per-call duration even when the same tool runs several times.
	CallID string `json:"call_id,omitempty"`
}

// TurnContextUsage mirrors bus.ContextUsage with the same JSON names the live
// "context_usage" WebSocket payload uses, snapshotted when the turn was
// persisted.
type TurnContextUsage struct {
	UsedTokens        int `json:"used_tokens"`
	TotalTokens       int `json:"total_tokens"`
	HistoryTokens     int `json:"history_tokens"`
	CompressAtTokens  int `json:"compress_at_tokens"`
	SummarizeAtTokens int `json:"summarize_at_tokens"`
	UsedPercent       int `json:"used_percent"`
}

// TurnStats is the detailed performance record of one assistant turn. It is the
// single shape shared by session JSONL, the pico WebSocket payload key
// "turn_stats" and the session REST message object, so the panel reads one
// contract whether the turn just streamed or came from history. Like Usage it is
// display/persistence only and never sent to a provider.
type TurnStats struct {
	// DurationMS is measured server-side from turn start to finalize; TimeToFirstTokenMS
	// is from turn start to the first streamed chunk of the whole turn.
	DurationMS         int64  `json:"duration_ms,omitempty"`
	TimeToFirstTokenMS int64  `json:"time_to_first_token_ms,omitempty"`
	FinishReason       string `json:"finish_reason,omitempty"`

	LLMCallCount        int `json:"llm_call_count"`
	ToolIterations      int `json:"tool_iterations"`
	StreamChunks        int `json:"stream_chunks,omitempty"`
	DroppedLLMCallCount int `json:"dropped_llm_call_count,omitempty"`
	DroppedToolCount    int `json:"dropped_tool_count,omitempty"`

	Tokens       TurnTokens        `json:"tokens"`
	LLMCalls     []LLMCallStat     `json:"llm_calls,omitempty"`
	Tools        []ToolStat        `json:"tools,omitempty"`
	ContextUsage *TurnContextUsage `json:"context_usage,omitempty"`
	// Cost is the money the turn's priced calls cost. Absent when no call matched
	// a price table.
	Cost *TurnCost `json:"cost,omitempty"`
}

// FileChange describes one file a turn modified. Diff is a unified diff capped by
// the tool that produced it; Additions/Deletions count changed lines.
//
// Hunks/OldPath/NewPath/FileLang/Binary are the structured form of the same diff,
// intended for rich diff view components (git-diff-view) that take hunks arrays
// rather than a pre-rendered diff string. Diff (the string) stays for the LLM
// context and the markdown message panel.
type FileChange struct {
	Path      string `json:"path"`
	Diff      string `json:"diff,omitempty"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`

	// OldPath/NewPath are the a/ and b/ names from the diff header; for plain
	// edits both equal Path, for renames they differ. Empty when the diff could
	// not be produced (e.g. file too large).
	OldPath string `json:"old_path,omitempty"`
	NewPath string `json:"new_path,omitempty"`

	// Hunks is the list of unified diff hunks (each starting with "@@"),
	// truncated at hunk boundaries so the renderer never sees a half hunk.
	// Empty when the diff was skipped or unavailable.
	Hunks []string `json:"hunks,omitempty"`

	// FileLang is the lowlight/highlight.js language id inferred from the
	// extension (e.g. "go", "typescript", "python"), empty when unknown.
	FileLang string `json:"file_lang,omitempty"`

	// Binary marks a change where the content is not text (the tool layer skips
	// diffing in that case, so Hunks will be empty).
	Binary bool `json:"binary,omitempty"`
}

// CacheControl marks a content block for LLM-side prefix caching.
// Currently only "ephemeral" is supported (used by Anthropic).
type CacheControl struct {
	Type string `json:"type"` // "ephemeral"
}

// ContentBlock represents a structured segment of a system message.
// Adapters that understand SystemParts can use these blocks to set
// per-block cache control (e.g. Anthropic's cache_control: ephemeral).
type ContentBlock struct {
	Type         string        `json:"type"` // "text"
	Text         string        `json:"text"`
	CacheControl *CacheControl `json:"cache_control,omitempty"`

	// Prompt metadata is internal to the agent runtime. It records which
	// structured prompt segment produced this block without changing provider
	// JSON.
	PromptLayer  string `json:"-"`
	PromptSlot   string `json:"-"`
	PromptSource string `json:"-"`
}

type Attachment struct {
	Type        string `json:"type,omitempty"`
	Ref         string `json:"ref,omitempty"`
	URL         string `json:"url,omitempty"`
	Filename    string `json:"filename,omitempty"`
	ContentType string `json:"content_type,omitempty"`
}

type Message struct {
	Role             string         `json:"role"`
	Content          string         `json:"content"`
	ModelName        string         `json:"model_name,omitempty"`
	CreatedAt        *time.Time     `json:"created_at,omitempty"`
	Media            []string       `json:"media,omitempty"`
	Attachments      []Attachment   `json:"attachments,omitempty"`
	ReasoningContent string         `json:"reasoning_content,omitempty"`
	SystemParts      []ContentBlock `json:"system_parts,omitempty"` // structured system blocks for cache-aware adapters
	ToolCalls        []ToolCall     `json:"tool_calls,omitempty"`
	ToolCallID       string         `json:"tool_call_id,omitempty"`

	// Usage is recorded on assistant turns for display only. Wire formats
	// (pkg/providers/common.openaiMessage) build their own message objects, so
	// this never reaches a provider endpoint.
	Usage *UsageInfo `json:"usage,omitempty"`

	// FileChanges lists the workspace files this turn modified, with a capped
	// unified diff. Like Usage it is display/persistence only and never sent to
	// a provider.
	FileChanges []FileChange `json:"file_changes,omitempty"`

	// Stats is the detailed performance record of the turn that produced this
	// message (token breakdown, per-call list, tool timings, context usage).
	// Absent for turns that never reached an LLM response.
	Stats *TurnStats `json:"turn_stats,omitempty"`

	// Prompt metadata is internal to the agent runtime. It records where a
	// message or system part came from without changing provider/session JSON.
	PromptLayer  string `json:"-"`
	PromptSlot   string `json:"-"`
	PromptSource string `json:"-"`
}

type ToolDefinition struct {
	Type     string                 `json:"type"`
	Function ToolFunctionDefinition `json:"function"`

	// Prompt metadata is internal to the agent runtime. Tool definitions are
	// model-visible capability prompts even though providers send them outside
	// the system message.
	PromptLayer  string `json:"-"`
	PromptSlot   string `json:"-"`
	PromptSource string `json:"-"`
}

type ToolFunctionDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}
