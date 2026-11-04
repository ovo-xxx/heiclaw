package toolshared

import (
	"strings"
	"testing"
)

func TestSplitDiffHunksKeepsWholeHunks(t *testing.T) {
	change := FileChangeFromContents(
		"/workspace/sample.go",
		[]byte("package a\n\nfunc one() {}\n\nfunc two() {}\n\nfunc three() {}\n"),
		[]byte("package a\n\nfunc one() { println(1) }\n\nfunc two() { println(2) }\n\nfunc three() {}\n"),
	)

	if len(change.Hunks) == 0 {
		t.Fatalf("hunks = %v, want at least one", change.Hunks)
	}
	for i, hunk := range change.Hunks {
		if !strings.HasPrefix(hunk, "@@") {
			t.Errorf("hunk %d does not start at a hunk header: %q", i, firstLine(hunk))
		}
		if strings.Contains(hunk, "\n@@") {
			t.Errorf("hunk %d carries a second header, so the split missed a boundary", i)
		}
		if strings.HasPrefix(hunk, "---") || strings.HasPrefix(hunk, "+++") {
			t.Errorf("hunk %d carries the file header, which the panel draws itself", i)
		}
	}

	// The body lines of all hunks together must add up to the same +/− counts the
	// record reports, or the panel would show numbers no line backs.
	var added, removed int
	for _, hunk := range change.Hunks {
		for _, line := range strings.Split(hunk, "\n") {
			switch {
			case strings.HasPrefix(line, "++"), strings.HasPrefix(line, "--"):
			case strings.HasPrefix(line, "+"):
				added++
			case strings.HasPrefix(line, "-"):
				removed++
			}
		}
	}
	if added != change.Additions || removed != change.Deletions {
		t.Errorf("hunk lines +%d/-%d, record +%d/-%d", added, removed, change.Additions, change.Deletions)
	}
}

func TestFileChangeHeaderPaths(t *testing.T) {
	change := FileChangeFromContents("/workspace/sample.py", []byte("a\n"), []byte("a\nb\n"))

	if change.OldPath == "" || change.NewPath == "" {
		t.Fatalf("old/new path = %q %q, want both filled from the diff header", change.OldPath, change.NewPath)
	}
	for _, p := range []string{change.OldPath, change.NewPath} {
		if strings.HasPrefix(p, "a/") || strings.HasPrefix(p, "b/") {
			t.Errorf("path %q still carries the diff prefix", p)
		}
		if strings.Contains(p, "\t") {
			t.Errorf("path %q carries the tab-separated timestamp", p)
		}
	}
	if change.FileLang != "python" {
		t.Errorf("file_lang = %q, want python", change.FileLang)
	}
}

func TestFileChangeWithoutContentChangeHasNoHunks(t *testing.T) {
	content := []byte("same\n")
	change := FileChangeFromContents("/workspace/keep.txt", content, content)

	if len(change.Hunks) != 0 {
		t.Errorf("hunks = %v, want none for an unchanged file", change.Hunks)
	}
	if change.Binary {
		t.Error("binary = true for plain text")
	}
}

func TestFileChangeMarksBinaryContent(t *testing.T) {
	change := FileChangeFromContents("/workspace/blob.bin", []byte{0x00, 0x01, 0x02}, []byte{0x00, 0xFF, 0x02})

	if !change.Binary {
		t.Fatal("binary = false, want a NUL-bearing file marked binary")
	}
	if len(change.Hunks) != 0 || change.Diff != "" {
		t.Errorf("binary change still carries diff/hunks: %q %v", change.Diff, change.Hunks)
	}
}

func TestLooksBinaryContentKeepsMultibyteText(t *testing.T) {
	// A Chinese description whose 512th byte lands inside a three-byte rune must not
	// be mistaken for binary just because the sample was cut mid-character.
	text := strings.Repeat("记忆", 400) // 800 runes, 2400 bytes
	if looksBinaryContent([]byte(text)) {
		t.Fatal("UTF-8 text called binary")
	}
	if !looksBinaryContent([]byte("abc\x00def")) {
		t.Error("NUL byte not detected")
	}
	if looksBinaryContent(nil) {
		t.Error("empty content is not binary")
	}
}

func TestCapHunksDropsWholeHunksOnly(t *testing.T) {
	hunks := []string{
		"@@ -1,2 +1,3 @@\n a\n+b\n c",
		"@@ -40,2 +41,2 @@\n-d\n+e",
		"@@ -80,2 +81,2 @@\n-f\n+g",
	}

	kept := capHunks(hunks, 30)
	if len(kept) != 1 {
		t.Fatalf("kept %d hunk(s), want the budget to stop after the first: %v", len(kept), kept)
	}
	if kept[0] != hunks[0] {
		t.Errorf("kept hunk was cut: %q", kept[0])
	}
	if all := capHunks(hunks, 1<<20); len(all) != len(hunks) {
		t.Errorf("generous budget kept %d of %d", len(all), len(hunks))
	}
	if none := capHunks(nil, 1<<20); none != nil {
		t.Errorf("no hunks returned %#v, want nil", none)
	}
}

func TestFileLangFor(t *testing.T) {
	cases := map[string]string{
		"/x/y.go":            "go",
		"/x/Y.GO":            "go",
		"/x/App.tsx":         "typescript",
		"/x/app.js":          "javascript",
		"/x/notes.md":        "markdown",
		"/x/Dockerfile":      "dockerfile",
		"/x/weird.dockerfile": "dockerfile",
		"/x/no-extension":    "",
		"/x/mystery.qqq":     "",
	}
	for path, want := range cases {
		if got := fileLangFor(path); got != want {
			t.Errorf("fileLangFor(%q) = %q, want %q", path, got, want)
		}
	}
}

func firstLine(text string) string {
	if idx := strings.IndexByte(text, '\n'); idx >= 0 {
		return text[:idx]
	}
	return text
}
