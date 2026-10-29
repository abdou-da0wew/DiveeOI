BINARY ?= bin/diveeoi-ci

.PHONY: build test fmt check

build:
	mkdir -p bin
	go build -trimpath -o $(BINARY) ./cmd/diveeoi-ci

test:
	go test ./...

fmt:
	gofmt -w $$(find cmd internal -type f -name '*.go')

check:
	go vet ./...
	go test ./...
