// PicoClaw - Ultra-lightweight personal AI agent

package agent

import (
	"context"
	"strings"

	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/providers"
	"github.com/sipeed/picoclaw/pkg/session"
)

// SetupTurn extracts the one-time initialization phase, returning a
// turnExecution populated with history, messages, and candidate selection.
// It replaces lines 56-145 of the original runTurn.
func (p *Pipeline) SetupTurn(ctx context.Context, ts *turnState) (*turnExecution, error) {
	cfg := p.Cfg
	maxMediaSize := cfg.Agents.Defaults.GetMaxMediaSize()

	var history []providers.Message
	var summary string
	if !ts.opts.NoHistory {
		if resp, err := p.ContextManager.Assemble(ctx, &AssembleRequest{
			SessionKey: ts.sessionKey,
			Budget:     ts.agent.ContextWindow,
			MaxTokens:  ts.agent.MaxTokens,
		}); err == nil && resp != nil {
			history = resp.History
			summary = resp.Summary
		}
	}
	ts.captureRestorePoint(history, summary)

	contextualSkills := ts.activeSkills
	if ts.agent.ContextBuilder != nil {
		contextualSkills = ts.agent.ContextBuilder.ResolveActiveSkillsForContext(ts.activeSkills)
	}
	ts.recordSkillContextSnapshot(skillContextTriggerInitialBuild, contextualSkills)
	initialPromptReq := promptBuildRequestForTurn(ts, history, summary, ts.userMessage, ts.media, cfg)
	initialPromptReq.ActiveSkills = append([]string(nil), contextualSkills...)
	messages := ts.agent.ContextBuilder.BuildMessagesFromPrompt(initialPromptReq)
	currentTurnStart := len(messages)
	if strings.TrimSpace(ts.userMessage) != "" || len(ts.media) > 0 {
		currentTurnStart = len(messages) - 1
	}

	messages = resolveMediaRefs(messages, p.MediaStore, maxMediaSize, currentTurnStart)

	if !ts.opts.NoHistory {
		toolDefs := filterToolsByTurnProfile(ts.agent.Tools.ToProviderDefs(), ts.profile)
		if isOverContextBudget(ts.agent.ContextWindow, messages, toolDefs, ts.agent.MaxTokens) {
			logger.WarnCF("agent", "Proactive compression: context budget exceeded before LLM call",
				map[string]any{"session_key": ts.sessionKey})
			if err := p.ContextManager.Compact(ctx, &CompactRequest{
				SessionKey: ts.sessionKey,
				Reason:     ContextCompressReasonProactive,
				Budget:     ts.agent.ContextWindow,
			}); err != nil {
				logger.WarnCF("agent", "Proactive compact failed", map[string]any{
					"session_key": ts.sessionKey,
					"error":       err.Error(),
				})
			}
			ts.refreshRestorePointFromSession(ts.agent)
			if resp, err := p.ContextManager.Assemble(ctx, &AssembleRequest{
				SessionKey: ts.sessionKey,
				Budget:     ts.agent.ContextWindow,
				MaxTokens:  ts.agent.MaxTokens,
			}); err == nil && resp != nil {
				history = resp.History
				summary = resp.Summary
			}
			originalHistoryCount := len(history)
			var fit bool
			history, messages, fit = trimHistoryToFitContextWindow(
				history,
				func(trimmedHistory []providers.Message) []providers.Message {
					rebuildPromptReq := promptBuildRequestForTurn(
						ts,
						trimmedHistory,
						summary,
						ts.userMessage,
						ts.media,
						cfg,
					)
					rebuildPromptReq.ActiveSkills = append([]string(nil), contextualSkills...)
					rebuilt := ts.agent.ContextBuilder.BuildMessagesFromPrompt(rebuildPromptReq)
					rebuiltCurrentTurnStart := len(rebuilt)
					if strings.TrimSpace(ts.userMessage) != "" || len(ts.media) > 0 {
						rebuiltCurrentTurnStart = len(rebuilt) - 1
					}
					return resolveMediaRefs(rebuilt, p.MediaStore, maxMediaSize, rebuiltCurrentTurnStart)
				},
				ts.agent.ContextWindow,
				toolDefs,
				ts.agent.MaxTokens,
			)
			if dropped := originalHistoryCount - len(history); dropped > 0 {
				logger.WarnCF("agent", "Trimmed rebuilt history after proactive compaction", map[string]any{
					"session_key":     ts.sessionKey,
					"dropped_msgs":    dropped,
					"remaining_msgs":  len(history),
					"context_window":  ts.agent.ContextWindow,
					"max_tokens":      ts.agent.MaxTokens,
					"still_overlimit": !fit,
				})
			} else if !fit {
				logger.WarnCF("agent", "Context still exceeds budget "+
					"after proactive compaction rebuild", map[string]any{
					"session_key":    ts.sessionKey,
					"history_msgs":   len(history),
					"context_window": ts.agent.ContextWindow,
					"max_tokens":     ts.agent.MaxTokens,
				})
			}
		}
	}

	if !ts.opts.NoHistory && (strings.TrimSpace(ts.userMessage) != "" || len(ts.media) > 0) {
		rootMsg := userPromptMessage(ts.userMessage, ts.media)
		if len(rootMsg.Media) > 0 {
			ts.agent.Sessions.AddFullMessage(ts.sessionKey, rootMsg)
		} else {
			ts.agent.Sessions.AddMessage(ts.sessionKey, rootMsg.Role, rootMsg.Content)
		}
		ts.recordPersistedMessage(rootMsg)
		ts.ingestMessage(ctx, p.al, rootMsg)
	}

	activeCandidates, activeModel, usedLight := p.al.selectCandidates(ts.agent, ts.userMessage, messages)
	activeProvider := ts.agent.Provider
	if usedLight && ts.agent.LightProvider != nil {
		activeProvider = ts.agent.LightProvider
	}
	activeModelName := strings.TrimSpace(ts.agent.Model)
	if usedLight {
		activeModelName = strings.TrimSpace(sideQuestionModelName(ts.agent, true))
	}
	activeModelName = resolvedCandidateModelName(activeCandidates, activeModelName)

	exec := newTurnExecution(
		ts.agent,
		ts.opts,
		history,
		summary,
		messages,
	)
	exec.currentTurnStart = currentTurnStart
	exec.activeCandidates = activeCandidates
	exec.activeModel = activeModel
	exec.activeModelConfig = resolveActiveModelConfig(
		p.Cfg,
		ts.agent.Workspace,
		activeCandidates,
		activeModel,
		p.Cfg.Agents.Defaults.Provider,
	)
	exec.llmModelName = activeModelName
	exec.activeProvider = activeProvider
	exec.usedLight = usedLight

	p.applySessionModelOverride(ts, exec)

	return exec, nil
}

// applySessionModelOverride switches the turn to the model pinned for this
// session by the web panel. A per-message pin wins and is persisted, so the
// next turn keeps it; with no pin in the message the stored one is used. It
// runs at turn setup, so agent routing picks the light model only for sessions
// without a pin, and a before_llm hook can still change the model later in the
// turn. An unresolvable pin is logged and the agent's own model stands, so a
// stale pin never blocks a conversation.
func (p *Pipeline) applySessionModelOverride(ts *turnState, exec *turnExecution) {
	if p == nil || ts == nil || ts.agent == nil || exec == nil {
		return
	}
	modelStore, ok := ts.agent.Sessions.(session.MetadataAwareSessionStore)
	if !ok {
		return
	}

	pinned := strings.TrimSpace(ts.opts.ModelOverride)
	stored := strings.TrimSpace(modelStore.GetSessionModel(ts.sessionKey))
	if ts.opts.ModelOverrideSet && pinned == "" {
		// The panel said "follow the agent default": drop the stored pin so a
		// later turn cannot revive it.
		if stored != "" {
			modelStore.SetSessionModel(ts.sessionKey, "")
		}
		return
	}
	model := pinned
	if model == "" {
		model = stored
	}
	if model == "" || model == strings.TrimSpace(exec.llmModelName) {
		return
	}
	// A name that is not in model_list still resolves to a bare candidate on the
	// default provider, which then fails every call. Reject it here so one bad
	// pin cannot brick a conversation, the same way `switch model` does.
	if _, err := providers.ResolveModelConfig(p.Cfg, model); err != nil {
		logger.WarnCF("agent", "Ignored session model override", map[string]any{
			"session_key": ts.sessionKey,
			"model":       model,
			"error":       err.Error(),
		})
		return
	}
	if pinned != "" && pinned != stored {
		modelStore.SetSessionModel(ts.sessionKey, pinned)
	}

	exec.llmModel = model
	if err := p.applyBeforeLLMModelRewrite(ts, exec); err != nil {
		logger.WarnCF("agent", "Ignored session model override", map[string]any{
			"session_key": ts.sessionKey,
			"model":       model,
			"error":       err.Error(),
		})
		return
	}
	exec.llmModelName = strings.TrimSpace(exec.activeModel)
	if exec.llmModelName == "" {
		exec.llmModelName = model
	}
}
