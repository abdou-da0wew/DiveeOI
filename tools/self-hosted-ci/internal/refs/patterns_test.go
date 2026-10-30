package refs

import "testing"

func TestMatch(t *testing.T) {
	tests := []struct {
		pattern string
		value   string
		want    bool
	}{
		{"main", "main", true},
		{"main", "dev", false},
		{"release/*", "release/v1", true},
		{"release/*", "release/v1/fix", false},
		{"release/**", "release/v1/fix", true},
		{"v?.*", "v1.2", true},
		{"feature/[x]", "feature/[x]", true},
	}
	for _, test := range tests {
		t.Run(test.pattern+"/"+test.value, func(t *testing.T) {
			got, err := Match(test.pattern, test.value)
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("Match(%q, %q) = %v, want %v", test.pattern, test.value, got, test.want)
			}
		})
	}
}

func TestMatchRejectsEmptyPattern(t *testing.T) {
	if _, err := Match("", "main"); err == nil {
		t.Fatal("expected empty pattern to fail")
	}
}
