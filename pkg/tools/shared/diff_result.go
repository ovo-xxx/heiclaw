package toolshared

import (
	"bytes"
	"fmt"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/pmezard/go-difflib/difflib"

	"github.com/sipeed/picoclaw/pkg/providers"
)

const (
	noContentChangeDiffMessage = "(no content change)"
	noNewlineAtEOFMarker       = `\ No newline at end of file`
	diffPreviewSkippedMessage  = "[diff preview skipped: file too large for inline preview]"
	diffPreviewTruncatedNote   = "[diff preview truncated; call read_file for the full edited contents]"
	maxDiffInputBytes          = 64 * 1024
	maxDiffInputLines          = 2000
	maxUserDiffPreviewBytes    = 16 * 1024
)

// DiffResult creates a user-visible tool result containing a unified diff for
// a successful file edit. The diff is included for both the LLM and the user so
// the follow-up assistant response can reason about the resulting change set,
// including EOF newline transitions.
func DiffResult(path string, before, after []byte) *ToolResult {
	summary := fmt.Sprintf("File edited: %s", path)
	change := FileChangeFromContents(path, before, after)
	if exceedsDiffPreviewLimits(before, after) {
		skipped := SilentResult(summary + "\n" + diffPreviewSkippedMessage)
		change.Diff = ""
		skipped.FileChange = change
		return skipped
	}

	diff, err := buildUnifiedDiff(path, before, after)
	if err != nil {
		failed := UserResult(fmt.Sprintf("%s\n[diff unavailable: %v]", summary, err))
		change.Diff = ""
		failed.FileChange = change
		return failed
	}

	userDiff, truncated := truncateDiffPreview(diff, maxUserDiffPreviewBytes)
	userContent := fmt.Sprintf("%s\n```diff\n%s\n```", summary, userDiff)
	if truncated {
		userContent += "\n" + diffPreviewTruncatedNote
	}

	llmContent := summary
	if diff == noContentChangeDiffMessage {
		llmContent = summary + "\n" + noContentChangeDiffMessage
	} else if truncated {
		llmContent = summary + "\n" + diffPreviewTruncatedNote
	}

	return &ToolResult{
		ForLLM:     llmContent,
		ForUser:    userContent,
		Silent:     false,
		IsError:    false,
		Async:      false,
		FileChange: change,
	}
}

// FileChangeFromContents builds the structured change record for one edited file:
// a capped unified diff plus line counts. Tools that stay silent toward the chat
// (write_file, append_file) use it so the panel can still show what changed.
func FileChangeFromContents(path string, before, after []byte) *providers.FileChange {
	change := &providers.FileChange{Path: path, FileLang: fileLangFor(path)}
	if looksBinaryContent(before) || looksBinaryContent(after) {
		// A diff of bytes the panel cannot read would be noise, so the change is
		// reported as binary and carries no hunks.
		change.Binary = true
		return change
	}
	if exceedsDiffPreviewLimits(before, after) {
		return change
	}
	diff, err := buildUnifiedDiff(path, before, after)
	if err != nil {
		return change
	}
	change.Additions, change.Deletions = countChangedDiffLines(diff)
	preview, _ := truncateDiffPreview(diff, maxUserDiffPreviewBytes)
	change.Diff = preview
	change.OldPath, change.NewPath = diffHeaderPaths(diff)
	change.Hunks = capHunks(splitDiffHunks(diff), maxUserDiffPreviewBytes)
	return change
}

// splitDiffHunks cuts a unified diff at its @@ headers so a renderer gets whole
// hunks: a half hunk would print line numbers that no longer add up. The file header
// block above the first hunk is dropped, because the panel draws the path itself.
func splitDiffHunks(diff string) []string {
	var hunks []string
	var current []string
	for _, line := range strings.Split(diff, "\n") {
		if strings.HasPrefix(line, "@@") {
			if len(current) > 0 {
				hunks = append(hunks, strings.Join(current, "\n"))
			}
			current = []string{line}
			continue
		}
		if current == nil {
			continue
		}
		current = append(current, line)
	}
	if len(current) > 0 {
		hunks = append(hunks, strings.Join(current, "\n"))
	}
	return hunks
}

// capHunks keeps whole hunks inside the panel's byte budget, the same ceiling the
// preview string obeys. Dropping from the tail keeps the counts honest about what is
// shown: the renderer still lists every hunk it was given in full.
func capHunks(hunks []string, maxBytes int) []string {
	kept := make([]string, 0, len(hunks))
	total := 0
	for _, hunk := range hunks {
		if total+len(hunk) > maxBytes && len(kept) > 0 {
			break
		}
		kept = append(kept, hunk)
		total += len(hunk) + 1
	}
	if len(kept) == 0 {
		return nil
	}
	return kept
}

// diffHeaderPaths reads the names unified diff writes on its first two lines. The
// a/ and b/ prefixes are diff noise rather than part of the path, and a tab follows
// the name when a timestamp is present; only a rename makes the two differ.
func diffHeaderPaths(diff string) (oldPath, newPath string) {
	for _, line := range strings.Split(diff, "\n") {
		switch {
		case strings.HasPrefix(line, "--- "):
			oldPath = cleanDiffHeaderPath(strings.TrimPrefix(line, "--- "))
		case strings.HasPrefix(line, "+++ "):
			newPath = cleanDiffHeaderPath(strings.TrimPrefix(line, "+++ "))
		case strings.HasPrefix(line, "@@"):
			return oldPath, newPath
		}
	}
	return oldPath, newPath
}

func cleanDiffHeaderPath(raw string) string {
	if idx := strings.IndexByte(raw, '\t'); idx >= 0 {
		raw = raw[:idx]
	}
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "a/")
	raw = strings.TrimPrefix(raw, "b/")
	return raw
}

// looksBinaryContent sniffs the leading bytes the way read_file does: a NUL byte or
// invalid UTF-8 means the content is not text. The sample backs off to a rune
// boundary first, or a file whose 512th byte splits a multi-byte character would be
// called binary for no reason.
func looksBinaryContent(content []byte) bool {
	if len(content) == 0 {
		return false
	}
	sample := content
	if len(sample) > 512 {
		sample = sample[:512]
		// Back off to a rune boundary the same way the preview truncation does, or a
		// cut that lands inside a multi-byte character reads as invalid UTF-8 and the
		// file would be called binary for no reason.
		for len(sample) > 0 && !utf8.Valid(sample) {
			sample = sample[:len(sample)-1]
		}
	}
	if bytes.ContainsRune(sample, 0) {
		return true
	}
	return !utf8.Valid(sample)
}

// fileLangFor names the language for the syntax highlighter, which speaks
// highlight.js ids, from the file extension. An unknown extension answers empty and
// the panel renders the diff without highlighting rather than guessing.
var fileLangByExt = map[string]string{
	".go":         "go",
	".ts":         "typescript",
	".tsx":        "typescript",
	".js":         "javascript",
	".jsx":        "javascript",
	".mjs":        "javascript",
	".cjs":        "javascript",
	".json":       "json",
	".jsonc":      "json",
	".md":         "markdown",
	".markdown":   "markdown",
	".py":         "python",
	".rs":         "rust",
	".rb":         "ruby",
	".sh":         "bash",
	".bash":       "bash",
	".zsh":        "bash",
	".ps1":        "powershell",
	".yml":        "yaml",
	".yaml":       "yaml",
	".toml":       "ini",
	".ini":        "ini",
	".html":       "xml",
	".htm":        "xml",
	".xml":        "xml",
	".css":        "css",
	".scss":       "scss",
	".sql":        "sql",
	".c":          "c",
	".h":          "c",
	".cpp":        "cpp",
	".cc":         "cpp",
	".hpp":        "cpp",
	".java":       "java",
	".kt":         "kotlin",
	".cs":         "csharp",
	".php":        "php",
	".lua":        "lua",
	".dockerfile": "dockerfile",
}

func fileLangFor(path string) string {
	base := strings.ToLower(filepath.Base(path))
	if base == "dockerfile" {
		return "dockerfile"
	}
	return fileLangByExt[strings.ToLower(filepath.Ext(path))]
}

// countChangedDiffLines counts added and removed lines in a unified diff.
// Upstream's countDiffLines counts lines of file content, hence the separate name.
func countChangedDiffLines(diff string) (additions, deletions int) {
	for _, line := range strings.Split(diff, "\n") {
		switch {
		case strings.HasPrefix(line, "+++"), strings.HasPrefix(line, "---"):
		case strings.HasPrefix(line, "+"):
			additions++
		case strings.HasPrefix(line, "-"):
			deletions++
		}
	}
	return additions, deletions
}

func buildUnifiedDiff(path string, before, after []byte) (string, error) {
	diff, err := difflib.GetUnifiedDiffString(difflib.UnifiedDiff{
		A:        splitDiffLinesPreservingEOF(before),
		B:        splitDiffLinesPreservingEOF(after),
		FromFile: "a/" + diffDisplayPath(path),
		ToFile:   "b/" + diffDisplayPath(path),
		Context:  3,
	})
	if err != nil {
		return "", err
	}

	diff = strings.TrimRight(diff, "\n")
	if diff == "" {
		return noContentChangeDiffMessage, nil
	}

	return diff, nil
}

func splitDiffLinesPreservingEOF(content []byte) []string {
	if len(content) == 0 {
		return nil
	}

	lines := make([]string, 0, bytes.Count(content, []byte{'\n'})+1)
	lineStart := 0
	for i, b := range content {
		if b != '\n' {
			continue
		}
		lines = append(lines, string(content[lineStart:i+1]))
		lineStart = i + 1
	}
	if lineStart < len(content) {
		lines = append(lines, string(content[lineStart:]))
	}

	if lacksTrailingNewline(content) {
		lines[len(lines)-1] += "\n"
		lines = append(lines, noNewlineAtEOFMarker+"\n")
	}

	return lines
}

func lacksTrailingNewline(content []byte) bool {
	return len(content) > 0 && !bytes.HasSuffix(content, []byte("\n"))
}

func exceedsDiffPreviewLimits(before, after []byte) bool {
	return len(before) > maxDiffInputBytes ||
		len(after) > maxDiffInputBytes ||
		countDiffLines(before) > maxDiffInputLines ||
		countDiffLines(after) > maxDiffInputLines
}

func countDiffLines(content []byte) int {
	if len(content) == 0 {
		return 0
	}

	lines := bytes.Count(content, []byte{'\n'})
	if !bytes.HasSuffix(content, []byte("\n")) {
		lines++
	}
	return lines
}

func truncateDiffPreview(diff string, maxBytes int) (string, bool) {
	if maxBytes <= 0 || len(diff) <= maxBytes {
		return diff, false
	}

	truncated := diff[:maxBytes]
	for len(truncated) > 0 && !utf8.ValidString(truncated) {
		truncated = truncated[:len(truncated)-1]
	}

	lastNewline := strings.LastIndexByte(truncated, '\n')
	if lastNewline > 0 {
		truncated = truncated[:lastNewline]
	}

	truncated = strings.TrimRight(truncated, "\n")
	if truncated == "" {
		truncated = diff[:maxBytes]
		for len(truncated) > 0 && !utf8.ValidString(truncated) {
			truncated = truncated[:len(truncated)-1]
		}
		truncated = strings.TrimRight(truncated, "\n")
	}

	return truncated, true
}

func diffDisplayPath(path string) string {
	displayPath := strings.TrimLeft(filepath.ToSlash(path), "/")
	if displayPath == "" {
		return "file"
	}
	return displayPath
}
