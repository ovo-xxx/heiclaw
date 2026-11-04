package pricing

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/sipeed/picoclaw/pkg/providers"
)

// cst builds a wall-clock instant as DeepSeek states it: Beijing time. The zone is
// fixed because China keeps no daylight saving, so the test means the same thing
// on any build host.
func cst(year int, month time.Month, day, hour, minute int) time.Time {
	return time.Date(year, month, day, hour, minute, 0, 0, time.FixedZone("CST", 8*3600))
}

// The band is a property of the row, so the tests read it off the row the panel
// would resolve rather than off the package.
func deepSeekRow(t *testing.T) Table {
	t.Helper()
	table, ok := TableFor("deepseek-flash")
	if !ok {
		t.Fatal("no flash row to test the band against")
	}
	return table
}

func TestIsPeakWindows(t *testing.T) {
	row := deepSeekRow(t)
	cases := []struct {
		name string
		at   time.Time
		want bool
	}{
		{"weekday morning slot", cst(2026, time.November, 4, 9, 30), true},
		{"weekday morning edge open", cst(2026, time.November, 4, 9, 0), true},
		{"weekday noon is off-peak", cst(2026, time.November, 4, 12, 0), false},
		{"weekday just before noon", cst(2026, time.November, 4, 11, 59), true},
		{"lunch break", cst(2026, time.November, 4, 13, 0), false},
		{"weekday afternoon slot", cst(2026, time.November, 4, 14, 0), true},
		{"weekday six pm is off-peak", cst(2026, time.November, 4, 18, 0), false},
		{"night", cst(2026, time.November, 4, 3, 0), false},
		{"saturday inside the window", cst(2026, time.November, 7, 10, 0), false},
		{"sunday inside the window", cst(2026, time.November, 8, 10, 0), false},
		// 2026-10-05 is a Monday inside the 国庆节 range, so it is off-peak all day.
		{"statutory holiday on a weekday", cst(2026, time.October, 5, 10, 0), false},
		{"weekday before the holiday range", cst(2026, time.September, 30, 10, 0), true},
		// 2027 has no published arrangement in the table yet, so only the weekday
		// rule applies and a Wednesday still reads as peak.
		{"uncovered year falls back to weekday rule", cst(2027, time.March, 3, 10, 0), true},
	}
	for _, tc := range cases {
		if got := row.IsPeak(tc.at); got != tc.want {
			t.Errorf("%s: IsPeak(%s) = %v, want %v", tc.name, tc.at.Format(time.RFC3339), got, tc.want)
		}
	}
}

// The store and the request clock can be UTC; the band is decided in the zone the
// row names, no matter which zone the instant arrived in.
func TestIsPeakConvertsFromUTC(t *testing.T) {
	row := deepSeekRow(t)
	utc := time.Date(2026, time.November, 4, 2, 30, 0, 0, time.UTC) // 10:30 in Beijing
	if !row.IsPeak(utc) {
		t.Fatalf("IsPeak(%s) = false, want true (10:30 Beijing)", utc.Format(time.RFC3339))
	}
	lateUTC := time.Date(2026, time.November, 3, 20, 30, 0, 0, time.UTC) // 04:30 next day
	if row.IsPeak(lateUTC) {
		t.Fatalf("IsPeak(%s) = true, want false (04:30 Beijing)", lateUTC.Format(time.RFC3339))
	}
}

// A row that bills one rate all day carries no band, and the engine must not invent
// a peak hour for it. This is the shape every non-DeepSeek provider has today.
func TestRowWithoutBandNeverPeaks(t *testing.T) {
	single := Table{
		Name:     "flat-model",
		Currency: "USD",
		OffPeak:  Rate{InputPerMTok: 1},
		Peak:     Rate{InputPerMTok: 9},
	}
	for _, at := range []time.Time{
		time.Date(2026, time.November, 4, 10, 0, 0, 0, time.UTC),
		time.Date(2026, time.November, 4, 15, 0, 0, 0, time.UTC),
	} {
		if single.IsPeak(at) {
			t.Errorf("bandless row peaked at %s", at.Format(time.RFC3339))
		}
	}

	// A row whose window is stated in another zone is judged there, not in Beijing:
	// 13:30 UTC is inside this row's 13:00-17:00 UTC band.
	other := Table{
		Name:     "other-provider",
		Currency: "USD",
		OffPeak:  Rate{InputPerMTok: 1},
		Peak:     Rate{InputPerMTok: 2},
		Band:     newBand(0, []string{"13:00-17:00"}, nil),
	}
	if !other.IsPeak(time.Date(2026, time.November, 4, 13, 30, 0, 0, time.UTC)) {
		t.Error("13:30 UTC should be peak for a UTC-stated band")
	}
	if other.IsPeak(time.Date(2026, time.November, 4, 17, 0, 0, 0, time.UTC)) {
		t.Error("the range is half-open, 17:00 itself is off-peak")
	}
}

// A rule the provider wrote in a form we cannot read must degrade to "never peak",
// not to a guessed window, because guessing would bill the wrong rate.
func TestBandIgnoresUnparsableWindows(t *testing.T) {
	band := newBand(8*3600, []string{"25:00-26:00", "morning", "09:00-08:00"}, nil)
	if band.IsPeak(cst(2026, time.November, 4, 10, 0)) {
		t.Fatal("a band of unusable windows must never peak")
	}
}

func TestTableForStripsProviderPrefix(t *testing.T) {
	for _, model := range []string{"deepseek-flash", "DeepSeek/deepseek-flash", " deepseek-flash "} {
		table, ok := TableFor(model)
		if !ok || table.Name != "deepseek-flash" {
			t.Errorf("TableFor(%q) = %+v, %v; want the flash row", model, table, ok)
		}
	}
	if _, ok := TableFor("gpt-5-mini"); ok {
		t.Error("TableFor resolved a model no row covers")
	}
}

// A price typed on the model entry replaces the row's numbers but not its currency,
// and it has no band: one figure is what the user pays all day.
func TestForCallWithRatesUsesCustomRates(t *testing.T) {
	usage := providers.TurnTokens{InputTokens: 1_000_000, CacheReadTokens: 1_000_000, OutputTokens: 1_000_000}
	rates := &RatesOverride{InputPerMTok: 3, CacheReadPerMTok: 0.5, OutputPerMTok: 9}

	custom := ForCallWithRates("deepseek-flash", cst(2026, time.November, 4, 10, 0), usage, rates)
	if custom == nil {
		t.Fatal("custom rates produced no cost")
	}
	if !custom.Custom || custom.Peak {
		t.Fatalf("custom = %v, peak = %v; want custom and no band", custom.Custom, custom.Peak)
	}
	if custom.Currency != "CNY" {
		t.Errorf("currency = %q, want the row's CNY", custom.Currency)
	}
	if !close(custom.Amount, 12.5) {
		t.Errorf("amount = %v, want 3 + 0.5 + 9", custom.Amount)
	}

	builtin := ForCallWithRates("deepseek-flash", cst(2026, time.November, 4, 10, 0), usage, nil)
	if builtin == nil || builtin.Custom {
		t.Fatal("no rates must fall back to the row")
	}
	if !builtin.Peak {
		t.Error("the row's band must still apply when the user set no rates")
	}
}

// Three numbers alone cannot invent a currency or a band, so a model with no row
// stays unpriced even when it carries custom rates.
func TestForCallWithRatesRequiresARow(t *testing.T) {
	if cost := ForCallWithRates("gpt-5-mini", time.Now(), providers.TurnTokens{InputTokens: 10}, &RatesOverride{InputPerMTok: 1}); cost != nil {
		t.Fatalf("cost = %+v, want none for a model with no row", cost)
	}
}

// DeepSeek renamed the model: turns stored under the old id still carry it, and their
// cost must keep appearing after the rename.
func TestTableForResolvesLegacyNameAfterRename(t *testing.T) {
	table, ok := TableFor("deepseek-v4-flash")
	if !ok || table.Name != "deepseek-flash" {
		t.Fatalf("TableFor(legacy id) = %+v, %v; want the deepseek-flash row", table, ok)
	}
	if cost := ForCall("deepseek-v4-flash", cst(2026, time.November, 4, 3, 0), providers.TurnTokens{InputTokens: 1000}); cost == nil {
		t.Fatal("a stored turn under the old id lost its price")
	}
}

// A row keyed to a name no provider advertises prices nothing, and prices nothing
// quietly: the panel just stops showing money. This is the check that catches a
// provider renaming a model out from under a row.
func TestEveryRowIsAdvertisedByItsProvider(t *testing.T) {
	advertised := map[string]bool{}
	for _, option := range providers.ModelProviderOptions() {
		for _, model := range option.CommonModels {
			advertised[strings.ToLower(model)] = true
		}
	}

	for name := range tables {
		tail := strings.ToLower(name)
		if idx := strings.LastIndex(tail, "/"); idx >= 0 {
			tail = tail[idx+1:]
		}
		if !advertised[tail] {
			t.Errorf("price row %q matches no CommonModels entry, so no config can hit it", name)
		}
	}
	for legacy, current := range legacyModelNames {
		if _, ok := tables[current]; !ok {
			t.Errorf("legacy id %q points at %q, which is not a row", legacy, current)
		}
		if _, ok := tables[legacy]; ok {
			t.Errorf("legacy id %q is also a canonical row; the alias would never be reached", legacy)
		}
	}
}

func TestForCallPricesEachCategorySeparately(t *testing.T) {
	// Off-peak flash: 1元/百万 fresh input, 0.02元/百万 cached, 4元/百万 output.
	usage := providers.TurnTokens{
		InputTokens:     1000,
		CacheReadTokens: 90_000,
		OutputTokens:    500,
	}
	cost := ForCall("deepseek-flash", cst(2026, time.November, 4, 3, 0), usage)
	if cost == nil {
		t.Fatal("ForCall returned nothing for a covered model")
	}
	wantInput := 0.001
	wantCache := 0.0018
	wantOutput := 0.002
	if !close(cost.Input, wantInput) || !close(cost.CacheRead, wantCache) || !close(cost.Output, wantOutput) {
		t.Fatalf("breakdown = %v/%v/%v, want %v/%v/%v",
			cost.Input, cost.CacheRead, cost.Output, wantInput, wantCache, wantOutput)
	}
	if !close(cost.Amount, wantInput+wantCache+wantOutput) {
		t.Fatalf("amount = %v, want %v", cost.Amount, wantInput+wantCache+wantOutput)
	}
	if cost.Peak || cost.Currency != "CNY" {
		t.Fatalf("band/currency = %v %q, want off-peak CNY", cost.Peak, cost.Currency)
	}

	peak := ForCall("deepseek-flash", cst(2026, time.November, 4, 10, 0), usage)
	if !peak.Peak {
		t.Fatal("10:00 on a Wednesday should price as peak")
	}
	if !close(peak.Amount, cost.Amount*2) {
		t.Fatalf("peak amount = %v, want double the off-peak %v", peak.Amount, cost.Amount*2)
	}

	if ForCall("some-unknown-model", cst(2026, time.November, 4, 10, 0), usage) != nil {
		t.Error("an uncovered model must report no cost rather than a guessed one")
	}
}

func TestSumKeepsForeignCurrencyCallsOutOfTheTotal(t *testing.T) {
	calls := []providers.LLMCallStat{
		{Cost: &providers.CallCost{Currency: "CNY", Amount: 0.01}},
		{Cost: &providers.CallCost{Currency: "CNY", Amount: 0.02, Peak: true}},
		{Cost: &providers.CallCost{Currency: "USD", Amount: 0.30}},
		{}, // a call no price table covered
	}
	cost := Sum(calls, 6) // six calls ran, only four were recorded
	if cost == nil {
		t.Fatal("Sum returned nothing for priced calls")
	}
	if !close(cost.Amount, 0.03) || cost.CoveredCalls != 2 {
		t.Fatalf("amount/calls = %v/%d, want 0.03 over 2 calls", cost.Amount, cost.CoveredCalls)
	}
	if cost.PeakCalls != 1 || cost.OffPeakCalls != 1 {
		t.Fatalf("bands = peak %d off-peak %d, want 1 and 1", cost.PeakCalls, cost.OffPeakCalls)
	}
	// one foreign-currency call plus two calls that were never priced.
	if cost.Uncounted != 3 {
		t.Fatalf("uncounted = %d, want 3", cost.Uncounted)
	}
	if Sum([]providers.LLMCallStat{{}}, 1) != nil {
		t.Error("a turn with no priced call must carry no cost object")
	}
}

func close(a, b float64) bool { return math.Abs(a-b) < 1e-12 }
