package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The cap is per launcher process and shared by every dashboard client, so the
// web panel's terminal tabs all draw from it. It is env-driven to keep the
// number explicit; these tests cover the parsing and the reservation balance
// without needing a PTY.

func TestTerminalMaxSessionsEnv(t *testing.T) {
	t.Setenv(terminalMaxSessionsEnv, "")
	if got := terminalMaxSessions(); got != terminalDefaultMax {
		t.Fatalf("empty env: got %d, want default %d", got, terminalDefaultMax)
	}

	cases := []struct {
		value string
		want  int32
	}{
		{"1", 1},
		{"32", 32},
		{"64", 64},
		{"65", terminalMaxSessionsLimit},
		{"0", 0},
		{"-3", terminalDefaultMax},
		{"many", terminalDefaultMax},
		{" 12 ", 12},
	}
	for _, testCase := range cases {
		t.Run(testCase.value, func(t *testing.T) {
			t.Setenv(terminalMaxSessionsEnv, testCase.value)
			if got := terminalMaxSessions(); got != testCase.want {
				t.Fatalf("env %q: got %d, want %d", testCase.value, got, testCase.want)
			}
		})
	}
}

func TestTerminalSlotReservationStaysBalanced(t *testing.T) {
	t.Setenv(terminalMaxSessionsEnv, "2")
	h := NewHandler(t.TempDir() + "/config.json")

	if !h.reserveTerminalSlot() || !h.reserveTerminalSlot() {
		t.Fatal("two slots should be reservable under a cap of 2")
	}
	if h.reserveTerminalSlot() {
		t.Fatal("third reservation exceeded the cap")
	}
	if got := h.terminalActive.Load(); got != 2 {
		t.Fatalf("counter after a refused reservation = %d, want 2", got)
	}

	h.releaseTerminalSlot()
	h.releaseTerminalSlot()
	if got := h.terminalActive.Load(); got != 0 {
		t.Fatalf("counter after releases = %d, want 0", got)
	}
	if !h.reserveTerminalSlot() {
		t.Fatal("released slot was not handed back")
	}
	h.releaseTerminalSlot()
}

func TestTerminalWebSocketRefusesWhenFull(t *testing.T) {
	t.Setenv(terminalMaxSessionsEnv, "0")
	mux := http.NewServeMux()
	handler := NewHandler(t.TempDir() + "/config.json")
	handler.registerTerminalRoutes(mux)
	server := httptest.NewServer(mux)
	defer server.Close()

	resp, err := http.Get(server.URL + "/api/terminal/ws") //nolint:noctx // test helper
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusServiceUnavailable)
	}
	// A refused connection must not consume a slot.
	if got := handler.terminalActive.Load(); got != 0 {
		t.Fatalf("counter after refusal = %d, want 0", got)
	}
}

func TestTerminalCapacityEndpoint(t *testing.T) {
	t.Setenv(terminalMaxSessionsEnv, "3")
	mux := http.NewServeMux()
	handler := NewHandler(t.TempDir() + "/config.json")
	handler.registerTerminalRoutes(mux)
	server := httptest.NewServer(mux)
	defer server.Close()

	read := func() terminalCapacity {
		t.Helper()
		resp, err := http.Get(server.URL + "/api/terminal/capacity") //nolint:noctx // test helper
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d, want 200", resp.StatusCode)
		}
		var capacity terminalCapacity
		if err := json.NewDecoder(resp.Body).Decode(&capacity); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return capacity
	}

	if capacity := read(); capacity.Active != 0 || capacity.Max != 3 || !capacity.Available {
		t.Fatalf("empty pool reported %+v, want active 0 max 3 available", capacity)
	}

	if !handler.reserveTerminalSlot() {
		t.Fatal("reservation refused under the cap")
	}
	capacity := read()
	if capacity.Active != 1 || capacity.Available != true {
		t.Fatalf("after one reservation got %+v", capacity)
	}

	for range 2 {
		if !handler.reserveTerminalSlot() {
			t.Fatal("reservation refused under the cap")
		}
	}
	if capacity = read(); capacity.Available {
		t.Fatalf("full pool still reported available: %+v", capacity)
	}

	for range 3 {
		handler.releaseTerminalSlot()
	}
	if got := handler.terminalActive.Load(); got != 0 {
		t.Fatalf("counter after releases = %d, want 0", got)
	}
}
