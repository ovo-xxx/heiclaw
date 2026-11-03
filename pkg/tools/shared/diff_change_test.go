package toolshared

import (
	"strings"
	"testing"
)

func TestFileChangeFromContentsCountsAndDiff(t *testing.T) {
	before := []byte("line1\nline2\nline3\n")
	after := []byte("line1\nline2 changed\nline3\nline4\n")

	change := FileChangeFromContents("notes.md", before, after)
	if change == nil {
		t.Fatal("FileChangeFromContents returned nil")
	}
	if change.Path != "notes.md" {
		t.Fatalf("path = %q, want notes.md", change.Path)
	}
	if change.Additions != 2 || change.Deletions != 1 {
		t.Fatalf("counts = +%d -%d, want +2 -1 (diff: %q)", change.Additions, change.Deletions, change.Diff)
	}
	if !strings.Contains(change.Diff, "+line2 changed") || !strings.Contains(change.Diff, "-line2\n") {
		t.Fatalf("diff missing added/removed line: %q", change.Diff)
	}
}

func TestFileChangeFromContentsUnchangedFile(t *testing.T) {
	content := []byte("same\n")
	change := FileChangeFromContents("same.txt", content, content)
	if change.Additions != 0 || change.Deletions != 0 {
		t.Fatalf("unchanged file reported +%d -%d", change.Additions, change.Deletions)
	}
}
