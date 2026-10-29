package runner

import (
	"bytes"
	"strings"
	"testing"
)

func TestBoundedLogWriterAddsSingleTruncationMarker(t *testing.T) {
	var output bytes.Buffer
	writer := &boundedLogWriter{writer: &output, maxBytes: 128}
	input := strings.Repeat("x", 256)
	written, err := writer.Write([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	if written != len(input) {
		t.Fatalf("writer consumed %d bytes, want %d", written, len(input))
	}
	if output.Len() != 128 || !strings.Contains(output.String(), logTruncatedMarker) {
		t.Fatalf("output was not bounded and marked: len=%d output=%q", output.Len(), output.String())
	}
	if _, err := writer.Write([]byte("ignored")); err != nil {
		t.Fatal(err)
	}
	if output.Len() != 128 || strings.Count(output.String(), logTruncatedMarker) != 1 {
		t.Fatalf("truncated output changed after limit: %q", output.String())
	}
}
