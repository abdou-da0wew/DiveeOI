package refs

import (
	"fmt"
	"regexp"
	"strings"
)

func Match(pattern, value string) (bool, error) {
	if pattern == "" || len(pattern) > 256 {
		return false, fmt.Errorf("ref pattern must contain 1 to 256 characters")
	}
	var expression strings.Builder
	expression.WriteByte('^')
	for i := 0; i < len(pattern); i++ {
		switch pattern[i] {
		case '*':
			if i+1 < len(pattern) && pattern[i+1] == '*' {
				expression.WriteString(".*")
				i++
			} else {
				expression.WriteString("[^/]*")
			}
		case '?':
			expression.WriteString("[^/]")
		default:
			if strings.ContainsRune(`\\.+()|{}[]^$`, rune(pattern[i])) {
				expression.WriteByte('\\')
			}
			expression.WriteByte(pattern[i])
		}
	}
	expression.WriteByte('$')
	compiled, err := regexp.Compile(expression.String())
	if err != nil {
		return false, fmt.Errorf("invalid ref pattern %q: %w", pattern, err)
	}
	return compiled.MatchString(value), nil
}

func MatchesAny(patterns []string, value string) bool {
	for _, pattern := range patterns {
		matched, err := Match(pattern, value)
		if err == nil && matched {
			return true
		}
	}
	return false
}
