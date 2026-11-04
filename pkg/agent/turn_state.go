// PicoClaw - Ultra-lightweight personal AI agent

package agent

import (
	"context"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/providers"
	"github.com/sipeed/picoclaw/pkg/providers/pricing"
	"github.com/sipeed/picoclaw/pkg/session"
	"github.com/sipeed/picoclaw/pkg/tools"
)

// =============================================================================
// TurnPhase - represents the current phase of a turn
// =============================================================================

type TurnPhase string

const (
	TurnPhaseSetup      TurnPhase = "setup"
	TurnPhaseRunning    TurnPhase = "running"
	TurnPhaseTools      TurnPhase = "tools"
	TurnPhaseFinalizing TurnPhase = "finalizing"
	TurnPhaseCompleted  TurnPhase = "completed"
	TurnPhaseAborted    TurnPhase = "aborted"
)

// =============================================================================
// Control signals - returned from Pipeline methods to drive runTurn's coordinator loop
// =============================================================================

type Control int

const (
	// ControlContinue tells the coordinator to jump back to the top of the turn loop
	// (equivalent to the original "goto turnLoop").
	ControlContinue Control = iota
	// ControlBreak tells the coordinator to exit the turn loop and proceed to Finalize.
	ControlBreak
	// ControlToolLoop tells the coordinator to execute the tool loop.
	ControlToolLoop
)

// ToolControl signals returned from ExecuteTools to drive tool loop iteration.
type ToolControl int

const (
	// ToolControlContinue tells the tool loop to jump to the next iteration
	// (pendingMessages arrived, SubTurn results, etc.).
	ToolControlContinue ToolControl = iota
	// ToolControlBreak tells the tool loop to exit and return to the coordinator.
	ToolControlBreak
	// ToolControlFinalize tells the coordinator that all tool responses were
	// handled and the turn should finalize without another LLM call.
	ToolControlFinalize
)

// LLMPhase indicates which phase the turn is executing in.
type LLMPhase int

const (
	LLMPhaseSetup LLMPhase = iota
	LLMPhasePreLLM
	LLMPhaseLLMCall
	LLMPhaseProcessing
	LLMPhaseToolLoop
	LLMPhaseTools
	LLMPhaseFinalizing
	LLMPhaseCompleted
	LLMPhaseAborted
)

// =============================================================================
// turnResult - returned from runTurn
// =============================================================================

type turnResult struct {
	finalContent string
	modelName    string
	status       TurnEndStatus
	followUps    []bus.InboundMessage
}

// =============================================================================
// ActiveTurnInfo - public info about an active turn
// =============================================================================

const (
	// maxRecordedLLMCalls caps the per-call list kept in one turn's stats. A turn
	// this many calls deep is already pathological, and session JSONL lines are
	// size-capped, so calls beyond it still count in the totals but are reported
	// through dropped_llm_call_count.
	maxRecordedLLMCalls = 50

	// maxRecordedToolStats caps the per-tool list in the same payload for the
	// same reason.
	maxRecordedToolStats = 40
)

type ActiveTurnInfo struct {
	TurnID       string
	AgentID      string
	SessionKey   string
	Channel      string
	ChatID       string
	UserMessage  string
	Phase        TurnPhase
	Iteration    int
	StartedAt    time.Time
	Depth        int
	ParentTurnID string
	ChildTurnIDs []string
}

// llmCallMetrics collects the per-call signals that only exist in-process: how
// the call streamed and which candidate answered it.
type llmCallMetrics struct {
	// provider is the config provider key of the candidate that answered.
	provider string
	// fallbackAttempt is the 1-based position in the fallback chain that
	// succeeded; 0 means the primary candidate (or no chain) answered.
	fallbackAttempt int
	// chunks / ttftMS describe the streamed attempt, if there was one. A stream
	// that failed and was re-issued as a plain completion is already tracked by
	// turnExecution.streamingFallback.
	chunks int
	ttftMS int64
}

// =============================================================================
// turnExecution - mutable state that persists across turn loop iterations
// =============================================================================

// llmCallStat spells one completed provider response as the per-call entry of
// the turn performance record. Latency covers the whole attempt (including the
// stream-to-completion fallback), attempts come from llmCallMetrics.
func llmCallStat(
	exec *turnExecution,
	iteration int,
	attempts int,
	latency time.Duration,
	startedAt time.Time,
) providers.LLMCallStat {
	stat := providers.LLMCallStat{
		Iteration:        iteration,
		Model:            strings.TrimSpace(exec.llmModel),
		Provider:         exec.lastCallMetrics.provider,
		FinishReason:     exec.response.FinishReason,
		Tokens:           exec.response.Usage.AsTurnTokens(),
		LatencyMS:        latency.Milliseconds(),
		TTFTMS:           exec.lastCallMetrics.ttftMS,
		Chunks:           exec.lastCallMetrics.chunks,
		StreamedFallback: exec.streamingFallback,
		FallbackAttempt:  exec.lastCallMetrics.fallbackAttempt,
		ToolCalls:        len(exec.response.ToolCalls),
		ContentChars:     len(exec.response.Content),
	}
	if attempts > 1 {
		stat.RetryAttempt = attempts
	}
	if !startedAt.IsZero() {
		stat.StartedAtMS = startedAt.UnixMilli()
		// The price row is looked up by the model this call was actually made
		// against, which is the same string the panel shows. activeModelConfig only
		// fills in on the switch/override paths, where the recorded name is the
		// user's alias ("fast") and the resolved entry carries the upstream
		// identifier a price table knows.
		model := stat.Model
		var rates *pricing.RatesOverride
		if exec.activeModelConfig != nil {
			cfgModel := exec.activeModelConfig.Model
			if _, ok := pricing.TableFor(model); !ok {
				model = cfgModel
			}
			// The custom rates belong to the entry the turn selected. A fallback that
			// answered under another id keeps its own row's numbers instead of
			// inheriting a price that was typed for a different model.
			if p := exec.activeModelConfig.Pricing; !p.IsZero() && pricing.SameRow(model, cfgModel) {
				rates = &pricing.RatesOverride{
					InputPerMTok:     p.InputPerMTok,
					CacheReadPerMTok: p.CacheReadPerMTok,
					OutputPerMTok:    p.OutputPerMTok,
				}
			}
		}
		stat.Cost = pricing.ForCallWithRates(model, startedAt, stat.Tokens, rates)
	}
	return stat
}

type turnExecution struct {
	// Core message state (accumulates throughout the turn)
	messages         []providers.Message // built from ContextBuilder, grows per-iteration
	pendingMessages  []providers.Message // steering/SubTurn messages awaiting injection
	history          []providers.Message // from ContextManager.Assemble
	summary          string
	currentTurnStart int

	// Turn output
	finalContent string

	// Iteration tracking
	iteration int

	// Per-iteration state set by Pipeline.PreLLM
	activeCandidates  []providers.FallbackCandidate
	activeModel       string
	activeModelConfig *config.ModelConfig
	activeProvider    providers.LLMProvider
	usedLight         bool

	// LLM call per-iteration state
	response            *providers.LLMResponse
	normalizedToolCalls []providers.ToolCall
	allResponsesHandled bool
	streamingPublisher  *streamingChunkPublisher
	streamingFallback   bool
	suppressReasoning   bool
	callMessages        []providers.Message
	providerToolDefs    []providers.ToolDefinition
	llmModel            string
	llmModelName        string
	llmOpts             map[string]any
	gracefulTerminal    bool
	useNativeSearch     bool
	ownedProviders      []providers.LLMProvider

	// lastCallMetrics carries the performance metrics of the LLM call that just
	// returned (streaming timings, which fallback candidate answered). CallLLM
	// folds it into the turn stats right after the response is validated, so it
	// only has to survive from the call to the record site.
	lastCallMetrics llmCallMetrics

	// Phase tracking
	phase LLMPhase

	// thinkingOverride is the panel's per-message thinking choice, already parsed.
	// Zero when the message said nothing, which leaves the model entry's level in
	// charge for the whole turn, including fallback candidates.
	thinkingOverride thinkingSettings

	// Abort signaling for coordinator (set by Pipeline methods)
	abortedByHardAbort bool // true when hard abort triggered during LLM/tools
	abortedByHook      bool // true when HookActionAbortTurn triggered
}

func (exec *turnExecution) closeOwnedProviders() {
	if exec == nil {
		return
	}
	closeUniqueStatefulProviders(exec.ownedProviders...)
	exec.ownedProviders = nil
}

// newTurnExecution creates a turnExecution initialized from turnState and options.
func newTurnExecution(
	agent *AgentInstance,
	opts processOptions,
	history []providers.Message,
	summary string,
	messages []providers.Message,
) *turnExecution {
	return &turnExecution{
		history:          history,
		summary:          summary,
		messages:         messages,
		pendingMessages:  append([]providers.Message(nil), opts.InitialSteeringMessages...),
		currentTurnStart: len(messages),
		iteration:        0,
		phase:            LLMPhaseSetup,
	}
}

// =============================================================================
// turnState - the full state for a turn, constructed once per turn
// =============================================================================

type turnState struct {
	mu sync.RWMutex

	agent   *AgentInstance
	opts    processOptions
	profile config.EffectiveTurnProfile
	scope   turnEventScope

	turnID            string
	agentID           string
	sessionKey        string
	activeSkills      []string
	attemptedSkills   []string
	skillContextTrace []SkillContextSnapshot
	toolKinds         []string
	toolExecutions    []ToolExecutionRecord
	turnCtx           *TurnContext

	channel     string
	chatID      string
	workspace   string
	userMessage string
	media       []string

	phase        TurnPhase
	iteration    int
	startedAt    time.Time
	finalContent string

	followUps []bus.InboundMessage

	gracefulInterrupt     bool
	gracefulInterruptHint string
	gracefulTerminalUsed  bool
	hardAbort             bool
	providerCancel        context.CancelFunc
	turnCancel            context.CancelFunc

	restorePointHistory []providers.Message
	restorePointSummary string
	persistedMessages   []providers.Message

	// SubTurn support (from HEAD)
	depth                int                    // SubTurn depth (0 for root turn)
	parentTurnID         string                 // Parent turn ID (empty for root turn)
	childTurnIDs         []string               // Child turn IDs
	pendingResults       chan *tools.ToolResult // Channel for SubTurn results
	concurrencySem       chan struct{}          // Semaphore for limiting concurrent SubTurns
	isFinished           atomic.Bool            // Whether this turn has finished
	session              session.SessionStore   // Session store reference
	initialHistoryLength int                    // Snapshot of history length at turn start

	// Additional SubTurn fields
	ctx             context.Context    // Context for this turn
	cancelFunc      context.CancelFunc // Cancel function for this turn's context
	critical        bool               // Whether this SubTurn should continue after parent ends
	parentTurnState *turnState         // Reference to parent turnState
	parentEnded     atomic.Bool        // Whether parent has ended
	closeOnce       sync.Once          // Ensures pendingResults channel is closed once
	finishedChan    chan struct{}      // Closed when turn finishes

	// Token budget tracking
	tokenBudget      *atomic.Int64           // Shared token budget counter
	lastFinishReason string                  // Last LLM finish_reason
	turnTokens       providers.TurnTokens    // Usage summed over every LLM call in this turn
	llmCallStats     []providers.LLMCallStat // Per-call breakdown, capped at maxRecordedLLMCalls
	llmCallCount     int                     // Calls recorded, including the dropped ones
	droppedLLMCalls  int                     // Calls folded into turnTokens but not listed
	streamChunks     int                     // Streamed chunks summed over all calls
	firstChunkAt     time.Time               // First streamed chunk of the whole turn
	turnStats        *providers.TurnStats    // Assembled once at finalize; shared by JSONL + WS

	// Files this turn modified, newest change per path in first-touched order
	fileChanges []providers.FileChange

	// Back-reference to the owning AgentLoop (set for SubTurns only, used for hard abort cascade)
	al *AgentLoop
}

// =============================================================================
// turnState constructors and active turn management
// =============================================================================

func newTurnState(agent *AgentInstance, opts processOptions, scope turnEventScope) *turnState {
	ts := &turnState{
		agent:        agent,
		opts:         opts,
		profile:      opts.TurnProfile,
		scope:        scope,
		turnID:       scope.turnID,
		agentID:      agent.ID,
		sessionKey:   opts.Dispatch.SessionKey,
		activeSkills: activeSkillNames(agent, opts),
		turnCtx:      cloneTurnContext(scope.context),
		channel:      opts.Dispatch.Channel(),
		chatID:       opts.Dispatch.ChatID(),
		workspace:    agent.Workspace,
		userMessage:  opts.Dispatch.UserMessage,
		media:        append([]string(nil), opts.Dispatch.Media...),
		phase:        TurnPhaseSetup,
		startedAt:    time.Now(),
	}

	// Bind session store and capture initial history length for rollback logic
	if agent != nil && agent.Sessions != nil {
		ts.session = agent.Sessions
		history := agent.Sessions.GetHistory(opts.Dispatch.SessionKey)
		ts.initialHistoryLength = len(history)
		ts.restorePointHistory = append([]providers.Message(nil), history...)
		ts.restorePointSummary = agent.Sessions.GetSummary(opts.Dispatch.SessionKey)
	}

	return ts
}

func (al *AgentLoop) registerActiveTurn(ts *turnState) {
	al.activeTurnStates.Store(ts.sessionKey, ts)
}

func (al *AgentLoop) clearActiveTurn(ts *turnState) {
	al.releaseSessionTurnState(ts.sessionKey, ts)
}

func (al *AgentLoop) releaseSessionTurnState(sessionKey string, expected *turnState) {
	if expected == nil {
		al.activeTurnStates.Delete(sessionKey)
		return
	}
	if actual, ok := al.activeTurnStates.Load(sessionKey); ok && actual == expected {
		al.activeTurnStates.Delete(sessionKey)
	}
}

func (al *AgentLoop) getActiveTurnState(sessionKey string) *turnState {
	if val, ok := al.activeTurnStates.Load(sessionKey); ok {
		if ts, ok := val.(*turnState); ok {
			return ts
		}
		// Unexpected non-*turnState value — treat as "no active turn" to avoid
		// panics. This should not happen under normal operation.
	}
	return nil
}

// getAnyActiveTurnState returns any active turn state (for backward compatibility)
func (al *AgentLoop) getAnyActiveTurnState() *turnState {
	var firstTS *turnState
	al.activeTurnStates.Range(func(key, value any) bool {
		if ts, ok := value.(*turnState); ok {
			firstTS = ts
			return false
		}
		return true
	})
	return firstTS
}

func (al *AgentLoop) GetActiveTurn() *ActiveTurnInfo {
	// For backward compatibility, return the first active turn found
	// In the new architecture, there can be multiple concurrent turns
	var firstTS *turnState
	al.activeTurnStates.Range(func(key, value any) bool {
		if ts, ok := value.(*turnState); ok {
			firstTS = ts
			return false
		}
		return true
	})
	if firstTS == nil {
		return nil
	}
	info := firstTS.snapshot()
	return &info
}

func (al *AgentLoop) GetActiveTurnBySession(sessionKey string) *ActiveTurnInfo {
	ts := al.getActiveTurnState(sessionKey)
	if ts == nil {
		return nil
	}
	info := ts.snapshot()
	return &info
}

// =============================================================================
// turnState - getters and setters
// =============================================================================

func (ts *turnState) snapshot() ActiveTurnInfo {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	return ActiveTurnInfo{
		TurnID:       ts.turnID,
		AgentID:      ts.agentID,
		SessionKey:   ts.sessionKey,
		Channel:      ts.channel,
		ChatID:       ts.chatID,
		UserMessage:  ts.userMessage,
		Phase:        ts.phase,
		Iteration:    ts.iteration,
		StartedAt:    ts.startedAt,
		Depth:        ts.depth,
		ParentTurnID: ts.parentTurnID,
		ChildTurnIDs: append([]string(nil), ts.childTurnIDs...),
	}
}

func (ts *turnState) setPhase(phase TurnPhase) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.phase = phase
}

func (ts *turnState) setIteration(iteration int) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.iteration = iteration
}

func (ts *turnState) currentIteration() int {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.iteration
}

func (ts *turnState) setFinalContent(content string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.finalContent = content
}

func (ts *turnState) finalContentLen() int {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return len(ts.finalContent)
}

func (ts *turnState) finalContentSnapshot() string {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.finalContent
}

func (ts *turnState) recordToolKind(tool string) {
	tool = strings.TrimSpace(tool)
	if tool == "" {
		return
	}

	ts.mu.Lock()
	defer ts.mu.Unlock()

	for _, existing := range ts.toolKinds {
		if existing == tool {
			return
		}
	}
	ts.toolKinds = append(ts.toolKinds, tool)
}

func (ts *turnState) toolKindsSnapshot() []string {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return append([]string(nil), ts.toolKinds...)
}

func (ts *turnState) recordToolExecution(
	tool string,
	success bool,
	errorSummary string,
	skillNames []string,
	durationMS int64,
	callID string,
) {
	tool = strings.TrimSpace(tool)
	if tool == "" {
		return
	}

	ts.recordToolKind(tool)

	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.toolExecutions = append(ts.toolExecutions, ToolExecutionRecord{
		Name:         tool,
		Success:      success,
		ErrorSummary: strings.TrimSpace(errorSummary),
		SkillNames:   append([]string(nil), skillNames...),
		DurationMS:   durationMS,
		CallID:       strings.TrimSpace(callID),
	})
}

func (ts *turnState) toolExecutionsSnapshot() []ToolExecutionRecord {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	if len(ts.toolExecutions) == 0 {
		return nil
	}

	out := make([]ToolExecutionRecord, 0, len(ts.toolExecutions))
	for _, exec := range ts.toolExecutions {
		out = append(out, ToolExecutionRecord{
			Name:         exec.Name,
			Success:      exec.Success,
			ErrorSummary: exec.ErrorSummary,
			SkillNames:   append([]string(nil), exec.SkillNames...),
			DurationMS:   exec.DurationMS,
		})
	}
	return out
}

func (ts *turnState) recordAttemptedSkills(skillNames []string) {
	if len(skillNames) == 0 {
		return
	}

	ts.mu.Lock()
	defer ts.mu.Unlock()

	for _, skillName := range skillNames {
		skillName = strings.TrimSpace(skillName)
		if skillName == "" {
			continue
		}
		seen := false
		for _, existing := range ts.attemptedSkills {
			if existing == skillName {
				seen = true
				break
			}
		}
		if seen {
			continue
		}
		ts.attemptedSkills = append(ts.attemptedSkills, skillName)
	}
}

func (ts *turnState) attemptedSkillsSnapshot() []string {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return append([]string(nil), ts.attemptedSkills...)
}

func (ts *turnState) recordSkillContextSnapshot(trigger string, skillNames []string) {
	if len(skillNames) == 0 {
		return
	}

	filtered := make([]string, 0, len(skillNames))
	for _, skillName := range skillNames {
		skillName = strings.TrimSpace(skillName)
		if skillName == "" {
			continue
		}
		filtered = append(filtered, skillName)
	}
	if len(filtered) == 0 {
		return
	}

	ts.recordAttemptedSkills(filtered)

	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.skillContextTrace = append(ts.skillContextTrace, SkillContextSnapshot{
		Sequence:   len(ts.skillContextTrace) + 1,
		Trigger:    trigger,
		SkillNames: append([]string(nil), filtered...),
	})
}

func (ts *turnState) latestSkillContextSnapshot() []string {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	if len(ts.skillContextTrace) == 0 {
		return nil
	}
	return append([]string(nil), ts.skillContextTrace[len(ts.skillContextTrace)-1].SkillNames...)
}

func (ts *turnState) skillContextSnapshotsSnapshot() []SkillContextSnapshot {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	if len(ts.skillContextTrace) == 0 {
		return nil
	}

	snapshots := make([]SkillContextSnapshot, 0, len(ts.skillContextTrace))
	for _, snapshot := range ts.skillContextTrace {
		snapshots = append(snapshots, SkillContextSnapshot{
			Sequence:   snapshot.Sequence,
			Trigger:    snapshot.Trigger,
			SkillNames: append([]string(nil), snapshot.SkillNames...),
		})
	}
	return snapshots
}

func (ts *turnState) setTurnCancel(cancel context.CancelFunc) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.turnCancel = cancel
}

func (ts *turnState) setProviderCancel(cancel context.CancelFunc) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.providerCancel = cancel
}

func (ts *turnState) clearProviderCancel(_ context.CancelFunc) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.providerCancel = nil
}

func (ts *turnState) requestGracefulInterrupt(hint string) bool {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if ts.hardAbort {
		return false
	}
	ts.gracefulInterrupt = true
	ts.gracefulInterruptHint = hint
	return true
}

func (ts *turnState) gracefulInterruptRequested() (bool, string) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.gracefulInterrupt && !ts.gracefulTerminalUsed, ts.gracefulInterruptHint
}

func (ts *turnState) markGracefulTerminalUsed() {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.gracefulTerminalUsed = true
}

func (ts *turnState) requestHardAbort() bool {
	ts.mu.Lock()
	if ts.hardAbort {
		ts.mu.Unlock()
		return false
	}
	ts.hardAbort = true
	turnCancel := ts.turnCancel
	providerCancel := ts.providerCancel
	ts.mu.Unlock()

	if providerCancel != nil {
		providerCancel()
	}
	if turnCancel != nil {
		turnCancel()
	}
	return true
}

func (ts *turnState) hardAbortRequested() bool {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.hardAbort
}

func (ts *turnState) eventMeta(source, tracePath string) HookMeta {
	snap := ts.snapshot()
	return HookMeta{
		AgentID:     snap.AgentID,
		TurnID:      snap.TurnID,
		SessionKey:  snap.SessionKey,
		Iteration:   snap.Iteration,
		Source:      source,
		TracePath:   tracePath,
		turnContext: cloneTurnContext(ts.turnCtx),
	}
}

func (ts *turnState) captureRestorePoint(history []providers.Message, summary string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.restorePointHistory = append([]providers.Message(nil), history...)
	ts.restorePointSummary = summary
}

func (ts *turnState) recordPersistedMessage(msg providers.Message) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.persistedMessages = append(ts.persistedMessages, msg)
}

func (ts *turnState) persistedMessagesSnapshot() []providers.Message {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return append([]providers.Message(nil), ts.persistedMessages...)
}

func (ts *turnState) refreshRestorePointFromSession(agent *AgentInstance) {
	history := agent.Sessions.GetHistory(ts.sessionKey)
	summary := agent.Sessions.GetSummary(ts.sessionKey)

	persisted := ts.persistedMessagesSnapshot()

	if matched := matchingTurnMessageTail(history, persisted); matched > 0 {
		history = append([]providers.Message(nil), history[:len(history)-matched]...)
	}

	ts.captureRestorePoint(history, summary)
}

// ingestMessage calls the ContextManager's Ingest method for a persisted message.
// Errors are logged but never block the turn.
func (ts *turnState) ingestMessage(ctx context.Context, al *AgentLoop, msg providers.Message) {
	if al.contextManager == nil {
		return
	}
	if err := al.contextManager.Ingest(ctx, &IngestRequest{
		SessionKey: ts.sessionKey,
		Message:    msg,
	}); err != nil {
		logger.WarnCF("agent", "Context manager ingest failed", map[string]any{
			"session_key": ts.sessionKey,
			"error":       err.Error(),
		})
	}
}

func (ts *turnState) restoreSession(agent *AgentInstance) error {
	ts.mu.RLock()
	history := append([]providers.Message(nil), ts.restorePointHistory...)
	summary := ts.restorePointSummary
	ts.mu.RUnlock()

	agent.Sessions.SetHistory(ts.sessionKey, history)
	agent.Sessions.SetSummary(ts.sessionKey, summary)
	return agent.Sessions.Save(ts.sessionKey)
}

func matchingTurnMessageTail(history, persisted []providers.Message) int {
	maxMatch := min(len(history), len(persisted))
	for size := maxMatch; size > 0; size-- {
		if messageSlicesEquivalent(history[len(history)-size:], persisted[len(persisted)-size:]) {
			return size
		}
	}
	return 0
}

func splitHistoryForActiveTurn(
	history []providers.Message,
	persisted []providers.Message,
) ([]providers.Message, []providers.Message) {
	matched := matchingTurnMessageTail(history, persisted)
	if matched <= 0 {
		return append([]providers.Message(nil), history...), nil
	}

	stable := append([]providers.Message(nil), history[:len(history)-matched]...)
	protected := append([]providers.Message(nil), history[len(history)-matched:]...)
	return stable, protected
}

func messageSlicesEquivalent(a, b []providers.Message) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !messagesEquivalent(a[i], b[i]) {
			return false
		}
	}
	return true
}

func messagesEquivalent(a, b providers.Message) bool {
	return reflect.DeepEqual(normalizeMessageForComparison(a), normalizeMessageForComparison(b))
}

func normalizeMessageForComparison(msg providers.Message) providers.Message {
	msg.PromptLayer = ""
	msg.PromptSlot = ""
	msg.PromptSource = ""

	if len(msg.Media) == 0 {
		msg.Media = nil
	}
	if len(msg.Attachments) == 0 {
		msg.Attachments = nil
	}
	if len(msg.SystemParts) == 0 {
		msg.SystemParts = nil
	} else {
		msg.SystemParts = append([]providers.ContentBlock(nil), msg.SystemParts...)
		for i := range msg.SystemParts {
			msg.SystemParts[i].PromptLayer = ""
			msg.SystemParts[i].PromptSlot = ""
			msg.SystemParts[i].PromptSource = ""
		}
	}
	if len(msg.ToolCalls) == 0 {
		msg.ToolCalls = nil
	} else {
		msg.ToolCalls = append([]providers.ToolCall(nil), msg.ToolCalls...)
		for i := range msg.ToolCalls {
			msg.ToolCalls[i].Name = ""
			msg.ToolCalls[i].Arguments = nil
			msg.ToolCalls[i].ThoughtSignature = ""
			if msg.ToolCalls[i].Function != nil {
				fn := *msg.ToolCalls[i].Function
				fn.ThoughtSignature = ""
				msg.ToolCalls[i].Function = &fn
			}
		}
	}

	return msg
}

func (ts *turnState) interruptHintMessage() providers.Message {
	_, hint := ts.gracefulInterruptRequested()
	content := "Interrupt requested. Stop scheduling tools and provide a short final summary."
	if hint != "" {
		content += "\n\nInterrupt hint: " + hint
	}
	return interruptPromptMessage(content)
}

// =============================================================================
// SubTurn-related methods
// =============================================================================

// Finish marks the turn as finished and closes the pendingResults channel
func (ts *turnState) Finish(isHardAbort bool) {
	ts.isFinished.Store(true)

	// Close pendingResults channel exactly once
	ts.closeOnce.Do(func() {
		if ts.pendingResults != nil {
			close(ts.pendingResults)
		}
		ts.mu.Lock()
		if ts.finishedChan == nil {
			ts.finishedChan = make(chan struct{})
		}
		close(ts.finishedChan)
		ts.mu.Unlock()
	})

	// Any graceful finish must signal direct children so nested SubTurns can
	// observe parent completion and decide whether to stop or continue.
	if !isHardAbort {
		ts.parentEnded.Store(true)
	}

	// Cancel the turn context
	if ts.cancelFunc != nil {
		ts.cancelFunc()
	}

	// Hard abort cascades to all child turns
	if isHardAbort && ts.al != nil {
		ts.mu.RLock()
		children := append([]string(nil), ts.childTurnIDs...)
		ts.mu.RUnlock()
		for _, childID := range children {
			if val, ok := ts.al.activeTurnStates.Load(childID); ok {
				if child, ok := val.(*turnState); ok {
					child.Finish(true)
				}
			}
		}
	}
}

// Finished returns whether the turn has finished
func (ts *turnState) Finished() chan struct{} {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if ts.finishedChan == nil {
		ts.finishedChan = make(chan struct{})
	}
	return ts.finishedChan
}

// IsParentEnded checks if the parent turn has ended
func (ts *turnState) IsParentEnded() bool {
	if ts.parentTurnState == nil {
		return false
	}
	return ts.parentTurnState.parentEnded.Load()
}

// GetLastFinishReason returns the last LLM finish_reason
func (ts *turnState) GetLastFinishReason() string {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.lastFinishReason
}

// SetLastFinishReason sets the last LLM finish_reason
func (ts *turnState) SetLastFinishReason(reason string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.lastFinishReason = reason
}

// GetTurnUsage returns token usage summed over every LLM call in this turn, or
// nil when nothing was recorded. A turn with tool loops makes several calls, so
// per-call usage understates what the turn actually cost. The detailed
// per-call breakdown lives in GetTurnStats.
func (ts *turnState) GetTurnUsage() *providers.UsageInfo {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	if ts.turnTokens.InputTokens == 0 && ts.turnTokens.OutputTokens == 0 {
		return nil
	}
	return &providers.UsageInfo{
		PromptTokens:     ts.turnTokens.InputTokens,
		CompletionTokens: ts.turnTokens.OutputTokens,
		TotalTokens:      ts.turnTokens.TotalTokens,
	}
}

// RecordLLMCall accounts for one completed LLM call of this turn: it folds the
// call's tokens into the turn total and appends the per-call entry.
//
// Session JSONL is append-only and read with a per-line size cap, so the listed
// calls stop at maxRecordedLLMCalls; the totals keep accumulating and the extra
// calls are counted in dropped_llm_call_count instead of being dropped silently.
func (ts *turnState) RecordLLMCall(call providers.LLMCallStat) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	call.Index = ts.llmCallCount
	ts.llmCallCount++
	ts.turnTokens.Add(call.Tokens)
	if call.Chunks > 0 {
		ts.streamChunks += call.Chunks
	}
	if len(ts.llmCallStats) < maxRecordedLLMCalls {
		ts.llmCallStats = append(ts.llmCallStats, call)
	} else {
		ts.droppedLLMCalls++
	}
}

// RecordStreamChunkTiming notes when the first streamed chunk of this turn
// arrived, so time-to-first-token can be measured from the turn start rather
// than from a single call.
func (ts *turnState) RecordStreamChunkTiming(firstChunkAt time.Time) {
	if firstChunkAt.IsZero() {
		return
	}
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if ts.firstChunkAt.IsZero() {
		ts.firstChunkAt = firstChunkAt
	}
}

// GetTurnStats returns the assembled performance record of this turn, or nil
// when no provider reported any token for it — the same rule the REST usage
// helper already applies, so a turn without usage carries no stats object at all.
// It is built once and cached, so the session JSONL, the pico WebSocket payload
// and the REST transcript all describe the same numbers (including duration)
// instead of three snapshots taken at different moments. Pass the context usage
// snapshot to attach; later calls reuse the cached value.
// accountingFor snapshots what the finished turn reports to the channel: tokens,
// changed files and the performance record, all built from the same cached state the
// session record uses.
func (ts *turnState) accountingFor(contextUsage *bus.ContextUsage) turnAccounting {
	if ts == nil {
		return turnAccounting{}
	}
	return turnAccounting{
		usage:       ts.GetTurnUsage(),
		fileChanges: ts.GetFileChanges(),
		stats:       ts.GetTurnStats(contextUsage),
	}
}

func (ts *turnState) GetTurnStats(contextUsage *bus.ContextUsage) *providers.TurnStats {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if ts.turnStats != nil {
		return ts.turnStats
	}
	if ts.turnTokens.IsZero() {
		return nil
	}

	stats := &providers.TurnStats{
		LLMCallCount:        ts.llmCallCount,
		DroppedLLMCallCount: ts.droppedLLMCalls,
		ToolIterations:      ts.iteration,
		StreamChunks:        ts.streamChunks,
		Tokens:              ts.turnTokens,
		FinishReason:        ts.lastFinishReason,
		LLMCalls:            append([]providers.LLMCallStat(nil), ts.llmCallStats...),
	}
	// Calls beyond the recorded cap cannot be priced, so the total says how many it
	// left out instead of reading as the whole bill.
	stats.Cost = pricing.Sum(stats.LLMCalls, ts.llmCallCount)
	if !ts.startedAt.IsZero() {
		stats.DurationMS = time.Since(ts.startedAt).Milliseconds()
	}
	if !ts.firstChunkAt.IsZero() && !ts.startedAt.IsZero() && ts.firstChunkAt.After(ts.startedAt) {
		stats.TimeToFirstTokenMS = ts.firstChunkAt.Sub(ts.startedAt).Milliseconds()
	}
	if len(ts.toolExecutions) > 0 {
		tools := make([]providers.ToolStat, 0, len(ts.toolExecutions))
		for _, exec := range ts.toolExecutions {
			if len(tools) >= maxRecordedToolStats {
				stats.DroppedToolCount = len(ts.toolExecutions) - len(tools)
				break
			}
			tools = append(tools, providers.ToolStat{
				Name:       exec.Name,
				OK:         exec.Success,
				DurationMS: exec.DurationMS,
				CallID:     exec.CallID,
			})
		}
		stats.Tools = tools
	}
	if contextUsage != nil {
		stats.ContextUsage = &providers.TurnContextUsage{
			UsedTokens:        contextUsage.UsedTokens,
			TotalTokens:       contextUsage.TotalTokens,
			HistoryTokens:     contextUsage.HistoryTokens,
			CompressAtTokens:  contextUsage.CompressAtTokens,
			SummarizeAtTokens: contextUsage.SummarizeAtTokens,
			UsedPercent:       contextUsage.UsedPercent,
		}
	}

	ts.turnStats = stats
	return stats
}

// RecordFileChange keeps the newest change for a path, in first-touched order:
// a file edited twice shows as the net result rather than two entries.
func (ts *turnState) RecordFileChange(change *providers.FileChange) {
	if change == nil || change.Path == "" {
		return
	}
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for i, existing := range ts.fileChanges {
		if existing.Path == change.Path {
			ts.fileChanges[i] = *change
			return
		}
	}
	ts.fileChanges = append(ts.fileChanges, *change)
}

func (ts *turnState) GetFileChanges() []providers.FileChange {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	if len(ts.fileChanges) == 0 {
		return nil
	}
	return append([]providers.FileChange(nil), ts.fileChanges...)
}

// =============================================================================
// Context helper functions for turnState
// =============================================================================

type turnStateKeyType struct{}

var turnStateKey = turnStateKeyType{}

func withTurnState(ctx context.Context, ts *turnState) context.Context {
	return context.WithValue(ctx, turnStateKey, ts)
}

func turnStateFromContext(ctx context.Context) *turnState {
	ts, _ := ctx.Value(turnStateKey).(*turnState)
	return ts
}

// TurnStateFromContext retrieves turnState from context (exported for tools)
func TurnStateFromContext(ctx context.Context) *turnState {
	return turnStateFromContext(ctx)
}
