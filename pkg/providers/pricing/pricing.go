// Package pricing turns a provider's published price table into the money one LLM
// call costs. Providers return token counts but rarely an amount, and some bill the
// same tokens at a different rate inside a peak window, so without this the panel
// can only show tokens and the user cannot tell what a turn cost.
package pricing

import (
	"strconv"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/providers"
)

// Rate prices one million tokens of a single category, in the table's currency.
type Rate struct {
	InputPerMTok     float64
	CacheReadPerMTok float64
	OutputPerMTok    float64
}

// Band is one table's own rule for which price band a call falls in. The rule
// belongs to the table, not to this package: DeepSeek doubles its prices inside a
// Beijing business window, while most providers bill one rate all day. A table with
// no Band never pays a peak rate.
type Band struct {
	// OffsetSeconds pins the wall clock the provider states its window in. A fixed
	// offset is used rather than a zone name because a Windows build host has no tz
	// database, and the providers that declare a window declare it in a zone with no
	// daylight saving anyway.
	OffsetSeconds int
	// Windows are the peak ranges as the provider writes them, "09:00-12:00". Each is
	// half-open at the end, so 12:00:00 itself is already off-peak.
	Windows []string
	// HolidayRanges are inclusive local dates, given as start/end pairs, that pull a
	// weekday out of the peak band. Empty means weekends are the only non-working
	// exception.
	HolidayRanges []string

	ranges   [][2]int
	holidays map[string]bool
}

// newBand parses the declared rule once, at table construction, so no turn has to
// re-parse it and nothing is lazily initialised under concurrent turns.
func newBand(offsetSeconds int, windows, holidayRanges []string) *Band {
	band := &Band{
		OffsetSeconds: offsetSeconds,
		Windows:       append([]string(nil), windows...),
		HolidayRanges: append([]string(nil), holidayRanges...),
		holidays:      map[string]bool{},
	}
	zone := time.FixedZone("band", offsetSeconds)
	for _, window := range band.Windows {
		start, end, ok := parseMinuteRange(window)
		if !ok {
			continue
		}
		band.ranges = append(band.ranges, [2]int{start, end})
	}
	for i := 0; i+1 < len(band.HolidayRanges); i += 2 {
		start, err := time.ParseInLocation("2006-01-02", band.HolidayRanges[i], zone)
		if err != nil {
			continue
		}
		end, err := time.ParseInLocation("2006-01-02", band.HolidayRanges[i+1], zone)
		if err != nil {
			continue
		}
		for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
			band.holidays[day.Format("2006-01-02")] = true
		}
	}
	return band
}

func parseMinuteRange(window string) (start, end int, ok bool) {
	parts := strings.SplitN(window, "-", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	start, ok = parseClock(strings.TrimSpace(parts[0]))
	if !ok {
		return 0, 0, false
	}
	end, ok = parseClock(strings.TrimSpace(parts[1]))
	if !ok || end <= start {
		return 0, 0, false
	}
	return start, end, true
}

func parseClock(clock string) (int, bool) {
	hour, minute, found := strings.Cut(clock, ":")
	if !found {
		return 0, false
	}
	h, err := strconv.Atoi(hour)
	if err != nil || h < 0 || h > 23 {
		return 0, false
	}
	m, err := strconv.Atoi(minute)
	if err != nil || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

// IsPeak reports whether the instant falls in this table's peak band. A Saturday or
// Sunday, or a day the table lists as a holiday, is never peak.
func (band *Band) IsPeak(at time.Time) bool {
	if band == nil || len(band.ranges) == 0 {
		return false
	}
	zone := time.FixedZone("band", band.OffsetSeconds)
	local := at.In(zone)
	if local.Weekday() == time.Saturday || local.Weekday() == time.Sunday {
		return false
	}
	if band.holidays[local.Format("2006-01-02")] {
		return false
	}
	minutes := local.Hour()*60 + local.Minute()
	for _, window := range band.ranges {
		if minutes >= window[0] && minutes < window[1] {
			return true
		}
	}
	return false
}

// Table is one model's price row, split by the two time bands the provider bills.
type Table struct {
	Name     string
	Currency string
	OffPeak  Rate
	Peak     Rate
	// Band is how this row decides between the two rates. nil bills OffPeak all day.
	Band *Band
	// Source is where the row was read from and when, shown in the panel so a
	// stale table is visible without opening the code.
	Source string
}

// IsPeak answers the band for this row, so callers never have to know which rule a
// provider happens to state.
func (t Table) IsPeak(at time.Time) bool { return t.Band.IsPeak(at) }

const deepSeekSource = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing · read 2026-11-04"

// deepSeekBand is DeepSeek's own window, quoted from its pricing page:
// 「北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；
// 其余时段，包括周末及中国法定节假日全天均为空闲时段。」
// The holidays are 国务院办公厅关于2026年部分节假日安排的通知
// (https://www.gov.cn/gongbao/2025/issue_12406/202511/content_7048922.html),
// published 2025-11-04 and read 2026-11-04. Only the 放假 ranges matter here: the
// 调休 makeup workdays fall on weekends, which the rule already treats as off-peak.
// The 2027 notice is not out yet, so a 2027 weekday is judged by the weekday rule
// alone until this list grows.
var deepSeekBand = newBand(8*3600,
	[]string{"09:00-12:00", "14:00-18:00"},
	[]string{
		"2026-01-01", "2026-01-03", // 元旦
		"2026-02-15", "2026-02-23", // 春节
		"2026-04-04", "2026-04-06", // 清明节
		"2026-05-01", "2026-05-05", // 劳动节
		"2026-06-19", "2026-06-21", // 端午节
		"2026-09-25", "2026-09-27", // 中秋节
		"2026-10-01", "2026-10-07", // 国庆节
	},
)

// tables is the DeepSeek row set as published on
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing, read 2026-11-04.
// Prices are CNY per million tokens. A new model or a price change means a new row
// here; unknown models are priced as nothing rather than guessed at, and callers
// show no cost for them.
var tables = map[string]Table{
	"deepseek-v4-flash": {
		Name:     "deepseek-v4-flash",
		Currency: "CNY",
		OffPeak:  Rate{InputPerMTok: 1, CacheReadPerMTok: 0.02, OutputPerMTok: 4},
		Peak:     Rate{InputPerMTok: 2, CacheReadPerMTok: 0.04, OutputPerMTok: 8},
		Band:     deepSeekBand,
		Source:   deepSeekSource,
	},
	"deepseek-v4-pro": {
		Name:     "deepseek-v4-pro",
		Currency: "CNY",
		OffPeak:  Rate{InputPerMTok: 4.5, CacheReadPerMTok: 0.15, OutputPerMTok: 13.5},
		Peak:     Rate{InputPerMTok: 9, CacheReadPerMTok: 0.3, OutputPerMTok: 27},
		Band:     deepSeekBand,
		Source:   deepSeekSource,
	},
}

// TableFor resolves the price row of an upstream model identifier. Providers may
// spell the model with a prefix ("deepseek/deepseek-flash"), so the tail after the
// last slash is what is matched.
func TableFor(model string) (Table, bool) {
	name := strings.ToLower(strings.TrimSpace(model))
	if name == "" {
		return Table{}, false
	}
	if idx := strings.LastIndex(name, "/"); idx >= 0 {
		name = name[idx+1:]
	}
	table, ok := tables[name]
	return table, ok
}

// ForCall prices one call. usage carries the panel-facing token names, where
// InputTokens is fresh input only and CacheReadTokens is the cached part billed at
// its own rate; ReasoningTokens needs no term of its own because it is a subset of
// OutputTokens and the provider prices it as output.
func ForCall(model string, at time.Time, usage providers.TurnTokens) *providers.CallCost {
	table, ok := TableFor(model)
	if !ok {
		return nil
	}
	rate := table.OffPeak
	peak := table.IsPeak(at)
	if peak {
		rate = table.Peak
	}
	const perMillion = 1_000_000
	input := float64(usage.InputTokens) / perMillion * rate.InputPerMTok
	cacheRead := float64(usage.CacheReadTokens) / perMillion * rate.CacheReadPerMTok
	output := float64(usage.OutputTokens) / perMillion * rate.OutputPerMTok
	return &providers.CallCost{
		Currency:      table.Currency,
		Amount:        input + cacheRead + output,
		Input:         input,
		CacheRead:     cacheRead,
		Output:        output,
		InputRate:     rate.InputPerMTok,
		CacheReadRate: rate.CacheReadPerMTok,
		OutputRate:    rate.OutputPerMTok,
		Peak:          peak,
		Table:         table.Name,
		Source:        table.Source,
	}
}

// Sum merges priced calls into the turn total. Calls in another currency are left
// out of the amount and only counted in Uncounted, so a mixed turn never reports a
// number that silently drops part of the bill.
func Sum(calls []providers.LLMCallStat, totalCalls int) *providers.TurnCost {
	var cost *providers.TurnCost
	for i := range calls {
		call := calls[i].Cost
		if call == nil {
			continue
		}
		if cost == nil {
			cost = &providers.TurnCost{Currency: call.Currency, Table: call.Table}
		} else if call.Currency != cost.Currency {
			cost.Uncounted++
			continue
		}
		cost.Amount += call.Amount
		cost.CoveredCalls++
		if call.Peak {
			cost.PeakCalls++
		} else {
			cost.OffPeakCalls++
		}
	}
	if cost == nil {
		return nil
	}
	cost.Uncounted += totalCalls - len(calls)
	return cost
}
