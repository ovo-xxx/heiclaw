//go:build !windows

package api

import (
	"os"
	"os/exec"
	"syscall"

	"github.com/creack/pty"
)

// startTerminalShell opens a login shell on a new PTY in dir.
func startTerminalShell(dir string, rows, cols uint16) (*terminalSession, error) {
	cmd := exec.Command(terminalShell(), "-l")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return nil, err
	}

	return &terminalSession{
		tty: ptmx,
		cmd: cmd,
		resize: func(r, c uint16) error {
			return pty.Setsize(ptmx, &pty.Winsize{Rows: r, Cols: c})
		},
	}, nil
}

func (s *terminalSession) killAndClose() {
	if s.tty != nil {
		_ = s.tty.Close()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		// pty.Start puts the shell in its own session, so the negative pid
		// reaches the whole tree (vim, ssh, a running build) instead of only
		// the shell. SIGKILL because a closing tab must not wait on it.
		_ = syscall.Kill(-s.cmd.Process.Pid, syscall.SIGKILL)
		_ = s.cmd.Wait()
	}
}
