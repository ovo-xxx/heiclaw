//go:build windows

package api

func startTerminalShell(_ string, _, _ uint16) (*terminalSession, error) {
	return nil, errTerminalUnsupported
}

func (s *terminalSession) killAndClose() {}
