// Package pricing turns a provider's published price table into the money one LLM
// call costs. DeepSeek returns token counts but never an amount, and it bills the
// same tokens at double during peak hours, so without this the panel can only show
// tokens and the user cannot tell what a turn cost.
package pricing

import (
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

// Table is one model's price row, split by the two time bands the provider bills.
type Table struct {
	Name     string
	Currency string
	OffPeak  Rate
	Peak     Rate
	// Source is where the row was read from and when, shown in the panel so a
	// stale table is visible without opening the code.
	Source string
}

const deepSeekSource = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing · 2026-11-04 取用"

// tables is the DeepSeek row set as published on
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing, read 2026-11-04.
// Prices are 元/百万 tokens. A new model or a price change means a new row here;
// unknown models are priced as nothing rather than guessed at, and callers show
// no cost for them.
var tables = map[string]Table{
	"deepseek-flash": {
		Name:     "deepseek-flash",
		Currency: "CNY",
		OffPeak:  Rate{InputPerMTok: 1, CacheReadPerMTok: 0.02, OutputPerMTok: 4},
		Peak:     Rate{InputPerMTok: 2, CacheReadPerMTok: 0.04, OutputPerMTok: 8},
		Source:   deepSeekSource,
	},
	"deepseek-v4-pro": {
		Name:     "deepseek-v4-pro",
		Currency: "CNY",
		OffPeak:  Rate{InputPerMTok: 4.5, CacheReadPerMTok: 0.15, OutputPerMTok: 13.5},
		Peak:     Rate{InputPerMTok: 9, CacheReadPerMTok: 0.3, OutputPerMTok: 27},
		Source:   deepSeekSource,
	},
}

// beijing is a fixed UTC+8 zone: China keeps no daylight saving time, and a Windows
// build host has no tz database to load the name from.
var beijing = time.FixedZone("CST", 8*3600)

// Peak window, verbatim from the DeepSeek pricing page:
// 「北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；
// 其余时段，包括周末及中国法定节假日全天均为空闲时段。」
// The two ranges are read as half-open, so 12:00:00 and 18:00:00 themselves are
// already off-peak.
func IsPeak(at time.Time) bool {
	local := at.In(beijing)
	switch local.Weekday() {
	case time.Saturday, time.Sunday:
		return false
	}
	if IsLegalHoliday(local) {
		return false
	}
	minutes := local.Hour()*60 + local.Minute()
	return (minutes >= 9*60 && minutes < 12*60) || (minutes >= 14*60 && minutes < 18*60)
}

// legalHolidays holds the mainland China statutory holidays that pull a weekday out
// of the peak band. Source: 国务院办公厅关于2026年部分节假日安排的通知
// (https://www.gov.cn/gongbao/2025/issue_12406/202511/content_7048922.html),
// published 2025-11-04 and read 2026-11-04. Only the 放假 ranges matter here: the
// 调休 makeup workdays fall on weekends, which the rule above already treats as
// off-peak. The 2027 notice is not out yet; a weekday it would have covered is
// judged by the weekday rule alone until this table grows.
var legalHolidays = holidaySet(
	"2026-01-01", "2026-01-03", // 元旦
	"2026-02-15", "2026-02-23", // 春节
	"2026-04-04", "2026-04-06", // 清明节
	"2026-05-01", "2026-05-05", // 劳动节
	"2026-06-19", "2026-06-21", // 端午节
	"2026-09-25", "2026-09-27", // 中秋节
	"2026-10-01", "2026-10-07", // 国庆节
)

func holidaySet(ranges ...string) map[string]bool {
	set := make(map[string]bool, len(ranges))
	for i := 0; i < len(ranges); i += 2 {
		start, err := time.ParseInLocation("2006-01-02", ranges[i], beijing)
		if err != nil {
			continue
		}
		end, err := time.ParseInLocation("2006-01-02", ranges[i+1], beijing)
		if err != nil {
			continue
		}
		for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
			set[day.Format("2006-01-02")] = true
		}
	}
	return set
}

// IsLegalHoliday reports whether the Beijing calendar date is a listed statutory
// holiday. Dates the table does not cover answer false.
func IsLegalHoliday(at time.Time) bool {
	return legalHolidays[at.In(beijing).Format("2006-01-02")]
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
	peak := IsPeak(at)
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
