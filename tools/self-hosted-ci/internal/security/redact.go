package security

import (
	"io"
	"sort"
	"strings"
)

func RedactText(value string, secrets []string) string {
	for _, secret := range sortedSecrets(secrets) {
		if secret != "" {
			value = strings.ReplaceAll(value, secret, "[REDACTED]")
		}
	}
	return value
}

func sortedSecrets(secrets []string) []string {
	unique := make(map[string]struct{}, len(secrets))
	result := make([]string, 0, len(secrets))
	for _, secret := range secrets {
		if secret == "" {
			continue
		}
		if _, found := unique[secret]; found {
			continue
		}
		unique[secret] = struct{}{}
		result = append(result, secret)
	}
	sort.Slice(result, func(i, j int) bool { return len(result[i]) > len(result[j]) })
	return result
}

// StreamRedactor masks exact secret values even when a process splits one across writes.
// Secret masking is defense in depth; trusted workflow code can still transform or exfiltrate secrets.
type StreamRedactor struct {
	writer  io.Writer
	secrets []string
	pending string
	maxLen  int
}

func NewStreamRedactor(writer io.Writer, secrets []string) *StreamRedactor {
	ordered := sortedSecrets(secrets)
	maxLen := 1
	for _, secret := range ordered {
		if len(secret) > maxLen {
			maxLen = len(secret)
		}
	}
	return &StreamRedactor{writer: writer, secrets: ordered, maxLen: maxLen}
}

func (r *StreamRedactor) Write(input []byte) (int, error) {
	combined := r.pending + string(input)
	if len(r.secrets) == 0 {
		r.pending = ""
		return writeAll(r.writer, []byte(combined), len(input))
	}
	cut := len(combined) - (r.maxLen - 1)
	if cut < 0 {
		cut = 0
	}
	cut = r.safeCut(combined, cut)
	safe := combined[:cut]
	r.pending = combined[cut:]
	return writeAll(r.writer, []byte(RedactText(safe, r.secrets)), len(input))
}

func (r *StreamRedactor) Close() error {
	if r.pending == "" {
		return nil
	}
	_, err := io.WriteString(r.writer, RedactText(r.pending, r.secrets))
	r.pending = ""
	return err
}

func (r *StreamRedactor) safeCut(value string, cut int) int {
	changed := true
	for changed {
		changed = false
		for _, secret := range r.secrets {
			limit := len(secret) - 1
			if limit > cut {
				limit = cut
			}
			for size := limit; size > 0; size-- {
				if value[cut-size:cut] == secret[:size] {
					cut -= size
					changed = true
					break
				}
			}
		}
	}
	return cut
}

func writeAll(writer io.Writer, value []byte, consumed int) (int, error) {
	written := 0
	for written < len(value) {
		n, err := writer.Write(value[written:])
		written += n
		if err != nil {
			return consumed, err
		}
		if n == 0 {
			return consumed, io.ErrShortWrite
		}
	}
	return consumed, nil
}
