package runner

import (
	"io"
	"sync"
)

const logTruncatedMarker = "\n[runner] run output truncated at 64 MiB\n"

type boundedLogWriter struct {
	mu        sync.Mutex
	writer    io.Writer
	maxBytes  int64
	written   int64
	truncated bool
}

func (writer *boundedLogWriter) Write(value []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if writer.truncated {
		return len(value), nil
	}
	limit := writer.maxBytes - int64(len(logTruncatedMarker))
	remaining := limit - writer.written
	if remaining < 0 {
		remaining = 0
	}
	toWrite := value
	if int64(len(toWrite)) > remaining {
		toWrite = toWrite[:remaining]
	}
	if len(toWrite) > 0 {
		n, err := writer.writer.Write(toWrite)
		writer.written += int64(n)
		if err != nil {
			return n, err
		}
		if n != len(toWrite) {
			return n, io.ErrShortWrite
		}
	}
	if len(toWrite) < len(value) {
		n, err := io.WriteString(writer.writer, logTruncatedMarker)
		if err != nil {
			return len(toWrite), err
		}
		if n != len(logTruncatedMarker) {
			return len(toWrite), io.ErrShortWrite
		}
		writer.written += int64(n)
		writer.truncated = true
	}
	return len(value), nil
}
