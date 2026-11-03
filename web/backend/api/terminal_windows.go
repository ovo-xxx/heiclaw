//go:build windows

package api

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/UserExistsError/conpty"
)

func windowsPowerShellPath() string {
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	return filepath.Join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

// terminalShellOnWindows resolves the shell explicitly: an override must exist,
// otherwise the built-in Windows PowerShell that ships with every install.
func terminalShellOnWindows() (string, error) {
	if shell := os.Getenv("PICOCLAW_TERMINAL_SHELL"); shell != "" {
		if _, err := os.Stat(shell); err != nil {
			return "", fmt.Errorf("PICOCLAW_TERMINAL_SHELL %q: %w", shell, err)
		}
		return shell, nil
	}
	path := windowsPowerShellPath()
	if _, err := os.Stat(path); err != nil {
		return "", fmt.Errorf("no shell at %s (set PICOCLAW_TERMINAL_SHELL): %w", path, err)
	}
	return path, nil
}

// startTerminalShell attaches a shell to a pseudo-console through the conpty
// library, which owns the Win32 sequence (pipes, attribute list,
// CreatePseudoConsole, CreateProcess). Rolling that by hand left the shell
// attached to the launcher's own console instead: the pipes carried nothing but
// conhost's init sequences and typed input was never echoed.
func startTerminalShell(dir string, rows, cols uint16) (*terminalSession, error) {
	shell, err := terminalShellOnWindows()
	if err != nil {
		return nil, err
	}
	if !conpty.IsConPtyAvailable() {
		return nil, errTerminalUnsupported
	}

	con, err := conpty.Start(
		`"`+shell+`"`,
		conpty.ConPtyDimensions(int(cols), int(rows)),
		conpty.ConPtyWorkDir(dir),
	)
	if err != nil {
		return nil, fmt.Errorf("start shell on pseudo-console: %w", err)
	}

	return &terminalSession{
		tty: con,
		resize: func(r, c uint16) error {
			if r == 0 || c == 0 {
				return errors.New("terminal: zero size")
			}
			// ConPty.Resize takes width before height.
			return con.Resize(int(c), int(r))
		},
	}, nil
}

// killAndClose terminates the shell and releases the pseudo-console, which also
// breaks the reader so terminal.go's two waiters both complete.
func (s *terminalSession) killAndClose() {
	con, ok := s.tty.(*conpty.ConPty)
	if !ok || con == nil {
		return
	}
	_ = con.Close()
}
