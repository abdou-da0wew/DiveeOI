package workflow

import "testing"

func TestParseAndOrderJobs(t *testing.T) {
	source := []byte(`version: 1
name: Build and deploy
jobs:
  deploy:
    needs: [test]
    image: alpine:3.21
    secrets: [DEPLOY_TOKEN]
    steps:
      - name: publish
        run: echo "$DEPLOY_TOKEN" >/dev/null
  test:
    steps:
      - run: go test ./...
`)
	parsed, err := Parse(source, "debian:bookworm-slim")
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Name != "Build and deploy" || len(parsed.Order) != 2 || parsed.Order[0] != "test" || parsed.Order[1] != "deploy" {
		t.Fatalf("unexpected normalized workflow: %+v", parsed)
	}
	if parsed.Jobs["test"].Image != "debian:bookworm-slim" {
		t.Fatalf("default image was not applied: %+v", parsed.Jobs["test"])
	}
}

func TestParseRejectsUnknownFields(t *testing.T) {
	_, err := Parse([]byte(`version: 1
jobs:
  test:
    steps:
      - run: echo ok
    uses: some-action
`), "debian:bookworm-slim")
	if err == nil {
		t.Fatal("expected unsupported job field to be rejected")
	}
}

func TestParseRejectsDependencyCycle(t *testing.T) {
	_, err := Parse([]byte(`version: 1
jobs:
  first:
    needs: [second]
    steps: [{run: echo first}]
  second:
    needs: [first]
    steps: [{run: echo second}]
`), "debian:bookworm-slim")
	if err == nil {
		t.Fatal("expected dependency cycle to be rejected")
	}
}

func TestParseValidatesArtifactPaths(t *testing.T) {
	parsed, err := Parse([]byte(`version: 1
jobs:
  build:
    artifacts: [dist, reports/test.xml]
    steps:
      - run: make build
`), "debian:bookworm-slim")
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Jobs["build"].Artifacts) != 2 {
		t.Fatalf("expected explicit artifact paths, got %+v", parsed.Jobs["build"].Artifacts)
	}
	for _, source := range []string{
		`version: 1
jobs:
  build:
    artifacts: [../outside]
    steps: [{run: make}]
`,
		`version: 1
jobs:
  build:
    artifacts: [.git/config]
    steps: [{run: make}]
`,
		`version: 1
jobs:
  build:
    artifacts: [dist, dist/app]
    steps: [{run: make}]
`,
	} {
		if _, err := Parse([]byte(source), "debian:bookworm-slim"); err == nil {
			t.Fatalf("expected invalid artifacts to be rejected: %s", source)
		}
	}
}

func TestParseRejectsHostSensitiveEnvAndInvalidWorkingDirectory(t *testing.T) {
	_, err := Parse([]byte(`version: 1
jobs:
  test:
    env:
      DOCKER_HOST: tcp://attacker
    steps:
      - run: echo unsafe
`), "debian:bookworm-slim")
	if err == nil {
		t.Fatal("expected Docker host override to be rejected")
	}

	_, err = Parse([]byte(`version: 1
jobs:
  test:
    steps:
      - run: echo unsafe
        workingDirectory: ../../etc
`), "debian:bookworm-slim")
	if err == nil {
		t.Fatal("expected path traversal to be rejected")
	}
}
