package main

import (
	"crypto/tls"
)

// insecureTLS is only used when the operator explicitly passes --insecure.
func insecureTLS() *tls.Config {
	return &tls.Config{InsecureSkipVerify: true} //nolint:gosec // opt-in flag
}
