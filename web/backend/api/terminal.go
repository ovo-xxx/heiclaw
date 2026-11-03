package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
)

// Browser terminal. The launcher already trusts the authenticated dashboard
// user, so the shell runs with the launcher's privileges (root when the service
// unit runs as root). This is a full server shell by explicit owner choice.
const (
	terminalMaxSessionsEnv = "PICOCLAW_TERMINAL_MAX_SESSIONS"
	terminalDefaultMax     = 8
	// Hard ceiling, so a typo in the environment cannot let the panel fork an
	// unbounded number of login shells.
	terminalMaxSessionsLimit = 64
	terminalReadChunk        = 32 * 1024
	terminalDefaultRows      = 24
	terminalDefaultCols      = 80
)

// terminalMaxSessions is the live cap on concurrent browser terminals. It is
// counted per launcher process, so it is shared by every dashboard client and
// every tab of every client; the web panel opens one PTY per terminal tab, and
// a tab is cheap to open but a real login shell.
// PICOCLAW_TERMINAL_MAX_SESSIONS overrides the default: 0 disables terminals,
// anything above terminalMaxSessionsLimit is clamped, and anything unparsable
// falls back to the default. Read per request so changing the environment only
// needs a launcher restart, and so a test can set it.
func terminalMaxSessions() int32 {
	raw := strings.TrimSpace(os.Getenv(terminalMaxSessionsEnv))
	if raw == "" {
		return terminalDefaultMax
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return terminalDefaultMax
	}
	if value > terminalMaxSessionsLimit {
		return terminalMaxSessionsLimit
	}
	return int32(value)
}

// terminalSession is one PTY plus the shell attached to it.
type terminalSession struct {
	tty       io.ReadWriteCloser
	cmd       *exec.Cmd
	resize    func(rows, cols uint16) error
	closeOnce sync.Once
}

// close is idempotent: the socket side and the output side may both reach it.
// Killing the shell is what unblocks the pending PTY read (a master read turns
// to EIO once the child is gone); closing the master alone does not, because
// Go's poller does not interrupt a blocking read on a tty.
func (s *terminalSession) close() {
	if s == nil {
		return
	}
	s.closeOnce.Do(s.killAndClose)
}

var terminalUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: terminalReadChunk,
	// A browser will send any page's WebSocket to this port; only same-origin
	// pages may attach, which is what keeps a random site from getting a shell.
	CheckOrigin: func(r *http.Request) bool {
		origin := ""
		if header := r.Header.Get("Origin"); header != "" {
			origin = header
		} else if referer := r.Header.Get("Referer"); referer != "" {
			origin = referer
		}
		if origin == "" {
			// Non-browser clients (curl, scripts) set no Origin header.
			return true
		}
		return sameLauncherRequestOrigin(r, origin)
	},
}

func (h *Handler) registerTerminalRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/terminal/ws", h.handleTerminalWS)
	// The panel asks before opening a tab: a failed WebSocket handshake does
	// not expose its HTTP status to the browser, so the "too many terminals"
	// reason has to come from here.
	mux.HandleFunc("GET /api/terminal/capacity", h.handleTerminalCapacity)
}

type terminalCapacity struct {
	Active    int32 `json:"active"`
	Max       int32 `json:"max"`
	Available bool  `json:"available"`
}

func (h *Handler) handleTerminalCapacity(w http.ResponseWriter, _ *http.Request) {
	active := h.terminalActive.Load()
	max := terminalMaxSessions()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(terminalCapacity{
		Active:    active,
		Max:       max,
		Available: active < max,
	}); err != nil {
		logger.Errorf("Terminal capacity write failed: %v", err)
	}
}

type terminalResize struct {
	Type string `json:"type"`
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

// reserveTerminalSlot claims one of the terminalMaxSessions() slots, or reports
// that the pool is full. The counter is a Handler field declared in router.go;
// the reservation lives here so every early return below releases exactly what
// it took, and the compare-and-swap keeps two clients racing the cap from both
// getting a shell.
func (h *Handler) reserveTerminalSlot() bool {
	for {
		active := h.terminalActive.Load()
		if active >= terminalMaxSessions() {
			return false
		}
		if h.terminalActive.CompareAndSwap(active, active+1) {
			return true
		}
	}
}

func (h *Handler) releaseTerminalSlot() {
	h.terminalActive.Add(-1)
}

func (h *Handler) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	if !h.reserveTerminalSlot() {
		http.Error(w, "terminal sessions exhausted", http.StatusServiceUnavailable)
		return
	}

	rows, cols := terminalDefaultRows, terminalDefaultCols
	if value, err := strconv.Atoi(r.URL.Query().Get("rows")); err == nil && value > 0 {
		rows = value
	}
	if value, err := strconv.Atoi(r.URL.Query().Get("cols")); err == nil && value > 0 {
		cols = value
	}

	session, err := startTerminalShell(h.terminalWorkingDir(), uint16(rows), uint16(cols))
	if err != nil {
		logger.Errorf("Terminal start failed: %v", err)
		h.releaseTerminalSlot()
		http.Error(w, "terminal unavailable", http.StatusNotImplemented)
		return
	}

	conn, err := terminalUpgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade already wrote the HTTP error.
		h.releaseTerminalSlot()
		session.close()
		return
	}

	defer func() {
		h.releaseTerminalSlot()
		session.close()
		conn.Close()
	}()

	// One goroutine per direction; the writer mutex keeps PTY output and
	// control frames from interleaving inside a message.
	writer := &lockedWsWriter{conn: conn}
	shellExited := make(chan struct{})
	socketClosed := make(chan struct{})

	go func() {
		defer close(shellExited)
		buf := make([]byte, terminalReadChunk)
		for {
			n, readErr := session.tty.Read(buf)
			if n > 0 {
				if writeErr := writer.writeBinary(buf[:n]); writeErr != nil {
					return
				}
			}
			if readErr != nil {
				_ = writer.writeClose(websocket.CloseNormalClosure, "shell exited")
				return
			}
		}
	}()

	go func() {
		defer close(socketClosed)
		for {
			messageType, data, readErr := conn.ReadMessage()
			if readErr != nil {
				return
			}
			switch messageType {
			case websocket.BinaryMessage:
				if _, err := session.tty.Write(data); err != nil {
					return
				}
			case websocket.TextMessage:
				var resize terminalResize
				if err := json.Unmarshal(data, &resize); err != nil {
					continue
				}
				if resize.Type == "resize" && resize.Rows > 0 && resize.Cols > 0 && session.resize != nil {
					_ = session.resize(resize.Rows, resize.Cols)
				}
			}
		}
	}()

	// A closed socket must end the shell, and killing the shell is also what
	// releases the blocked PTY read. Wait for the output goroutine afterwards so
	// neither leaks.
	select {
	case <-socketClosed:
		session.close()
	case <-shellExited:
	}
	<-socketClosed
}

type lockedWsWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (w *lockedWsWriter) writeBinary(data []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	// A deadline keeps this goroutine from parking forever on a socket whose
	// peer vanished mid-output; the handler waits for it before returning.
	_ = w.conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
	return w.conn.WriteMessage(websocket.BinaryMessage, data)
}

func (w *lockedWsWriter) writeClose(code int, text string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	_ = w.conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	defer w.conn.SetWriteDeadline(time.Time{})
	return w.conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(code, text))
}

// terminalShell picks the interactive shell, honouring SHELL then bash.
func terminalShell() string {
	if shell := strings.TrimSpace(os.Getenv("SHELL")); shell != "" {
		return shell
	}
	if _, err := exec.LookPath("bash"); err == nil {
		return "bash"
	}
	return "sh"
}

// terminalWorkingDir opens the terminal in the agent's workspace, so `ls` shows
// the same tree the agent works on. Falls back to the launcher's home directory.
func (h *Handler) terminalWorkingDir() string {
	cfg, err := config.LoadConfig(h.configPath)
	if err == nil {
		workspace := strings.TrimSpace(cfg.Agents.Defaults.Workspace)
		if info, statErr := os.Stat(workspace); statErr == nil && info.IsDir() {
			return workspace
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		return home
	}
	return "/"
}

var errTerminalUnsupported = errors.New("terminal not supported on this platform")
