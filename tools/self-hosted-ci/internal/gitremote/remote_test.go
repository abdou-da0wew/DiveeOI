package gitremote

import (
	"testing"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/config"
)

func TestParseRefsFiltersAndPeelsTags(t *testing.T) {
	remote := New(config.Repository{
		ID:       "demo",
		Branches: []string{"main", "release/*"},
		Tags:     []string{"v*"},
	})
	output := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main\n" +
		"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/heads/feature/test\n" +
		"cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v1.0\n" +
		"dddddddddddddddddddddddddddddddddddddddd\trefs/tags/v2.0\n" +
		"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\trefs/tags/v2.0^{}\n"
	refs := remote.parseRefs(output)
	if len(refs) != 3 {
		t.Fatalf("got %d refs: %+v", len(refs), refs)
	}
	byName := make(map[string]Ref)
	for _, ref := range refs {
		byName[ref.Name] = ref
	}
	if byName["refs/tags/v2.0"].SHA != "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" {
		t.Fatalf("annotated tag did not resolve to commit: %+v", byName["refs/tags/v2.0"])
	}
	if byName["refs/heads/main"].Event != "branch" || byName["refs/tags/v1.0"].Event != "tag" {
		t.Fatalf("unexpected event kinds: %+v", byName)
	}
}
