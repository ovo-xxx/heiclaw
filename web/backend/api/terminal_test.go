//go:build !windows

package api

import (
	"bytes"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// A PTY echoes typed input back, so a marker inside the command text would be
// matched by the echo rather than by the shell's answer. These tests send
// commands whose output cannot appear in the command line itself.

func dialTerminal(t *testing.T, serverURL string, query string) *websocket.Conn {
	t.Helper()
	url := strings.Replace(serverURL, "http://", "ws://", 1) + "/api/terminal/ws?" + query
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return conn
}

func serveTerminal(t *testing.T) (*httptest.Server, func()) {
	t.Helper()
	mux := http.NewServeMux()
	handler := NewHandler(t.TempDir() + "/config.json")
	handler.registerTerminalRoutes(mux)
	server := httptest.NewServer(mux)
	return server, server.Close
}

// readUntil accumulates PTY output until the needle appears or the deadline passes.
func readUntil(t *testing.T, conn *websocket.Conn, needle string, timeout time.Duration) string {
	t.Helper()
	var seen bytes.Buffer
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			continue
		}
		seen.Write(data)
		if strings.Contains(seen.String(), needle) {
			return seen.String()
		}
	}
	t.Fatalf("output never contained %q; got %q", needle, seen.String())
	return ""
}

func TestTerminalWebSocketRunsShellCommands(t *testing.T) {
	if testing.Short() {
		t.Skip("needs a PTY")
	}

	server, stop := serveTerminal(t)
	defer stop()
	conn := dialTerminal(t, server.URL, "rows=40&cols=120")
	defer conn.Close()

	// The shell answers "XOKY"; the echoed command line cannot contain that.
	if err := conn.WriteMessage(websocket.BinaryMessage, []byte("printf 'X%sY\\n' OK\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	readUntil(t, conn, "XOKY", 15*time.Second)
}

func TestTerminalResizeReachesPty(t *testing.T) {
	if testing.Short() {
		t.Skip("needs a PTY")
	}

	server, stop := serveTerminal(t)
	defer stop()
	conn := dialTerminal(t, server.URL, "rows=30&cols=100")
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage,
		[]byte(`{"type":"resize","rows":50,"cols":200}`)); err != nil {
		t.Fatalf("resize: %v", err)
	}

	// Output is "50x200" built from the live PTY size; the command line spells
	// the numbers only inside $(...) so an echo of the input cannot match.
	if err := conn.WriteMessage(websocket.BinaryMessage,
		[]byte("printf 'SZ%sx%s\\n' \"$(tput lines)\" \"$(tput cols)\"\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	readUntil(t, conn, "SZ50x200", 15*time.Second)
}

func TestTerminalCloseKillsProcessTree(t *testing.T) {
	if testing.Short() {
		t.Skip("needs a PTY")
	}

	session, err := startTerminalShell(t.TempDir(), 24, 80)
	if err != nil {
		t.Fatalf("startTerminalShell: %v", err)
	}
	pid := session.cmd.Process.Pid
	needle := longSleepNeedle()

	if _, err := session.tty.Write([]byte("sleep " + needle + "\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	time.Sleep(500 * time.Millisecond)

	session.close()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if !processGroupRunning(pid) && !sleepRunning(needle) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("close() left processes: pid %d alive=%v; sleepers=%s",
		pid, processExists(pid), sleepDetail(needle))
}

func processExists(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil
}

func processGroupRunning(pgid int) bool {
	err := syscall.Kill(-pgid, 0)
	return err == nil
}

// gateway_test.go leaves plain "sleep 30" processes running on purpose, and every
// test in this package shares one process table, so the terminal tests can only
// prove their own shell died by a sentinel no one else uses. A random fractional
// duration still runs for 30-40s, which outlives the assertions.
func longSleepNeedle() string {
	return fmt.Sprintf("3%d.%03d", rand.Intn(10), rand.Intn(1000))
}

func sleepRunning(needle string) bool {
	out, err := exec.Command("pgrep", "-f", "sleep "+needle).Output()
	return err == nil && len(bytes.TrimSpace(out)) > 0
}

func sleepDetail(needle string) string {
	out, _ := exec.Command("pgrep", "-af", "sleep "+needle).Output()
	return strings.TrimSpace(string(out))
}

// Closing the socket must take the shell's whole tree with it, or every closed
// tab would leave a session behind.
func TestTerminalClosesShellOnSocketClose(t *testing.T) {
	if testing.Short() {
		t.Skip("needs a PTY")
	}

	server, stop := serveTerminal(t)
	defer stop()
	conn := dialTerminal(t, server.URL, "rows=24&cols=80")

	needle := longSleepNeedle()
	if err := conn.WriteMessage(websocket.BinaryMessage,
		[]byte("sleep "+needle+"\n")); err != nil {
		t.Fatalf("write: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && !sleepRunning(needle) {
		time.Sleep(100 * time.Millisecond)
	}
	if !sleepRunning(needle) {
		t.Fatal("shell did not start the command")
	}

	conn.Close()
	deadline = time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if !sleepRunning(needle) {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("shell survived the socket close; still running: %s", sleepDetail(needle))
}
