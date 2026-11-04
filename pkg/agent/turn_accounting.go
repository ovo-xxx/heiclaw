package agent

import "github.com/sipeed/picoclaw/pkg/providers"

// turnAccounting is one finished turn's numbers. Where a turn's pipeline hands the
// answer back as a string (the sync dispatch path), the turn state is gone by the
// time the answer is published, so the numbers have to travel separately or the
// panel only sees them after re-reading the session.
type turnAccounting struct {
	usage       *providers.UsageInfo
	fileChanges []providers.FileChange
	stats       *providers.TurnStats
}

func (a turnAccounting) isEmpty() bool {
	return a.usage == nil && a.stats == nil && len(a.fileChanges) == 0
}

// rememberTurnAccounting stores the finished turn's numbers under its session.
func (al *AgentLoop) rememberTurnAccounting(sessionKey string, accounting turnAccounting) {
	if al == nil || sessionKey == "" || accounting.isEmpty() {
		return
	}
	al.turnAccounting.Store(sessionKey, accounting)
}

// takeTurnAccounting hands the numbers out once. An entry describes one turn;
// reusing it on a later error message would put this turn's numbers on that one.
func (al *AgentLoop) takeTurnAccounting(sessionKey string) turnAccounting {
	if al == nil || sessionKey == "" {
		return turnAccounting{}
	}
	value, ok := al.turnAccounting.LoadAndDelete(sessionKey)
	if !ok {
		return turnAccounting{}
	}
	accounting, _ := value.(turnAccounting)
	return accounting
}
