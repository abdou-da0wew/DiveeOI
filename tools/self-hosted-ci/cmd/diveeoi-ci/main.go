package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/config"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/runner"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/security"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/state"
	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/workflow"
)

const version = "0.1.0"

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" || args[0] == "-h" {
		printHelp()
		return 0
	}
	if args[0] == "version" || args[0] == "--version" {
		fmt.Printf("diveeoi-ci %s\n", version)
		return 0
	}
	var err error
	switch args[0] {
	case "daemon":
		err = daemonCommand(args[1:])
	case "check":
		err = checkCommand(args[1:])
	case "validate":
		err = validateCommand(args[1:])
	case "status":
		err = statusCommand(args[1:])
	case "logs":
		err = logsCommand(args[1:])
	case "artifacts":
		err = artifactsCommand(args[1:])
	case "secret":
		err = secretCommand(args[1:])
	case "run":
		err = manualRunCommand(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", args[0])
		printHelp()
		return 2
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}
	return 0
}

func parseConfigFlag(name string, args []string) (*flag.FlagSet, *string, error) {
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	configPath := flags.String("config", "./config.json", "path to runner JSON config")
	if err := flags.Parse(args); err != nil {
		return nil, nil, err
	}
	return flags, configPath, nil
}

func daemonCommand(args []string) error {
	_, configPath, err := parseConfigFlag("daemon", args)
	if err != nil {
		return err
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	store, err := state.Open(cfg.StorageDir)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runner.NewDaemon(cfg, store).Serve(ctx)
}

func checkCommand(args []string) error {
	_, configPath, err := parseConfigFlag("check", args)
	if err != nil {
		return err
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	if info, err := os.Lstat(cfg.StorageDir); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("storageDir: %w", err)
	} else if err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
		return fmt.Errorf("storageDir must be a real directory, not a symlink or file")
	}
	if err := runner.CheckDocker(context.Background(), cfg.Docker.Binary, cfg.Docker.Rootless); err != nil {
		return err
	}
	fmt.Printf("configuration OK; Docker is reachable; watching %d repository entries\n", len(cfg.Repositories))
	return nil
}

func validateCommand(args []string) error {
	flags := flag.NewFlagSet("validate", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	workflowPath := flags.String("workflow", ".diveeoi/pipeline.yml", "pipeline YAML path")
	image := flags.String("image", "debian:bookworm-slim", "default Docker image for jobs")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if err := config.ValidateImage(*image); err != nil {
		return err
	}
	contents, err := os.ReadFile(*workflowPath)
	if err != nil {
		return err
	}
	parsed, err := workflow.Parse(contents, *image)
	if err != nil {
		return err
	}
	fmt.Printf("pipeline %q is valid (%d jobs: %s)\n", parsed.Name, len(parsed.Order), strings.Join(parsed.Order, " -> "))
	return nil
}

func statusCommand(args []string) error {
	flags := flag.NewFlagSet("status", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	configPath := flags.String("config", "./config.json", "path to runner JSON config")
	limit := flags.Int("limit", 20, "number of recent runs to show (max 500)")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *limit < 1 || *limit > state.MaxHistory {
		return fmt.Errorf("limit must be between 1 and %d", state.MaxHistory)
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	snapshot, err := state.ReadSnapshot(cfg.StorageDir)
	if err != nil {
		return err
	}
	fmt.Printf("runner instance: %s\n", snapshot.Instance)
	if len(snapshot.Runs) == 0 {
		fmt.Println("no runs recorded yet")
		return nil
	}
	start := len(snapshot.Runs) - *limit
	if start < 0 {
		start = 0
	}
	fmt.Printf("%-12s %-16s %-10s %-28s %-12s %s\n", "RUN", "REPOSITORY", "STATUS", "REF", "SHA", "CREATED")
	for _, run := range snapshot.Runs[start:] {
		fmt.Printf("%-12s %-16s %-10s %-28s %-12s %s\n",
			shortID(run.ID), run.RepoID, run.Status, truncate(run.Ref, 28), run.SHA[:min(12, len(run.SHA))], run.CreatedAt.Local().Format(time.RFC3339))
	}
	return nil
}

func logsCommand(args []string) error {
	flags, configPath, err := parseConfigFlag("logs", args)
	if err != nil {
		return err
	}
	remaining := flags.Args()
	if len(remaining) != 1 || !validRunIDPrefix(remaining[0]) {
		return fmt.Errorf("usage: diveeoi-ci logs --config config.json <run-id-or-hex-prefix>")
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	snapshot, err := state.ReadSnapshot(cfg.StorageDir)
	if err != nil {
		return err
	}
	var run state.Run
	matches := 0
	for _, candidate := range snapshot.Runs {
		if strings.HasPrefix(candidate.ID, remaining[0]) {
			run = candidate
			matches++
		}
	}
	if matches == 0 {
		return fmt.Errorf("run %q not found", remaining[0])
	}
	if matches > 1 {
		return fmt.Errorf("run id prefix %q is ambiguous", remaining[0])
	}
	logPath, err := runner.RunLogPath(cfg.StorageDir, run)
	if err != nil {
		return err
	}
	info, err := os.Lstat(logPath)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("run log is not a regular file")
	}
	file, err := os.Open(logPath)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(os.Stdout, file)
	return err
}

func artifactsCommand(args []string) error {
	flags, configPath, err := parseConfigFlag("artifacts", args)
	if err != nil {
		return err
	}
	remaining := flags.Args()
	if len(remaining) != 1 || !validRunIDPrefix(remaining[0]) {
		return fmt.Errorf("usage: diveeoi-ci artifacts --config config.json <run-id-or-hex-prefix>")
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	snapshot, err := state.ReadSnapshot(cfg.StorageDir)
	if err != nil {
		return err
	}
	var run state.Run
	matches := 0
	for _, candidate := range snapshot.Runs {
		if strings.HasPrefix(candidate.ID, remaining[0]) {
			run = candidate
			matches++
		}
	}
	if matches == 0 {
		return fmt.Errorf("run %q not found", remaining[0])
	}
	if matches > 1 {
		return fmt.Errorf("run id prefix %q is ambiguous", remaining[0])
	}
	if len(run.Artifacts) == 0 {
		fmt.Println("no retained artifacts for this run")
		return nil
	}
	root, err := filepath.Abs(filepath.Join(cfg.StorageDir, "artifacts", run.ID))
	if err != nil {
		return err
	}
	rootInfo, err := os.Lstat(root)
	if os.IsNotExist(err) {
		fmt.Println("artifacts for this run have expired or were removed")
		return nil
	}
	if err != nil {
		return err
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("artifact run path is not a real directory")
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	found := 0
	for _, relative := range run.Artifacts {
		path := filepath.Join(cfg.StorageDir, filepath.FromSlash(relative))
		absolute, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, absolute)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
			return fmt.Errorf("state contains an unsafe artifact path")
		}
		parent, err := filepath.EvalSymlinks(filepath.Dir(absolute))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		resolvedPath := filepath.Join(parent, filepath.Base(absolute))
		resolvedRel, err := filepath.Rel(root, resolvedPath)
		if err != nil || resolvedRel == ".." || strings.HasPrefix(resolvedRel, ".."+string(filepath.Separator)) || filepath.IsAbs(resolvedRel) {
			return fmt.Errorf("artifact path resolves outside its run directory")
		}
		info, err := os.Lstat(absolute)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("artifact path is not a regular file")
		}
		fmt.Println(resolvedPath)
		found++
	}
	if found == 0 {
		fmt.Println("artifacts for this run have expired or were removed")
	}
	return nil
}

func secretCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: diveeoi-ci secret <set|list|delete> --config config.json <repo-id> [NAME]")
	}
	action := args[0]
	flags := flag.NewFlagSet("secret "+action, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	configPath := flags.String("config", "./config.json", "path to runner JSON config")
	readStdin := flags.Bool("stdin", false, "read a secret value from stdin; required for secret set")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	positional := flags.Args()
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	if len(positional) < 1 {
		return fmt.Errorf("repository id is required")
	}
	repoID := positional[0]
	if _, ok := findRepository(cfg, repoID); !ok {
		return fmt.Errorf("repository %q is not in runner config", repoID)
	}
	switch action {
	case "list":
		if len(positional) != 1 {
			return fmt.Errorf("usage: diveeoi-ci secret list --config config.json <repo-id>")
		}
		names, err := security.List(cfg.StorageDir, repoID)
		if err != nil {
			return err
		}
		if len(names) == 0 {
			fmt.Println("no secrets stored")
			return nil
		}
		for _, name := range names {
			fmt.Println(name)
		}
		return nil
	case "set":
		if len(positional) != 2 || !*readStdin {
			return fmt.Errorf("usage: printf '%%s' \"$VALUE\" | diveeoi-ci secret set --stdin --config config.json <repo-id> <NAME>")
		}
		name := positional[1]
		repo, _ := findRepository(cfg, repoID)
		if !contains(repo.AllowedSecrets, name) {
			return fmt.Errorf("secret %q is not in this repository's allowedSecrets config", name)
		}
		value, err := security.ReadSecret(os.Stdin)
		if err != nil {
			return err
		}
		if err := security.Set(cfg.StorageDir, repoID, name, value); err != nil {
			return err
		}
		fmt.Printf("stored encrypted secret %s for %s\n", name, repoID)
		return nil
	case "delete":
		if len(positional) != 2 {
			return fmt.Errorf("usage: diveeoi-ci secret delete --config config.json <repo-id> <NAME>")
		}
		deleted, err := security.Delete(cfg.StorageDir, repoID, positional[1])
		if err != nil {
			return err
		}
		if !deleted {
			return fmt.Errorf("secret %q was not found", positional[1])
		}
		fmt.Printf("deleted secret %s for %s\n", positional[1], repoID)
		return nil
	default:
		return fmt.Errorf("unknown secret action %q", action)
	}
}

func manualRunCommand(args []string) error {
	flags := flag.NewFlagSet("run", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	configPath := flags.String("config", "./config.json", "path to runner JSON config")
	repoID := flags.String("repo", "", "configured repository id")
	ref := flags.String("ref", "", "full ref, e.g. refs/heads/main")
	sha := flags.String("sha", "", "40- or 64-character commit id")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *repoID == "" || *ref == "" || *sha == "" {
		return fmt.Errorf("usage: diveeoi-ci run --config config.json --repo ID --ref refs/heads/main --sha SHA")
	}
	cfg, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	if err := runner.CheckDocker(context.Background(), cfg.Docker.Binary, cfg.Docker.Rootless); err != nil {
		return err
	}
	unlock, err := runner.AcquireLock(cfg.StorageDir)
	if err != nil {
		return err
	}
	defer unlock()
	store, err := state.Open(cfg.StorageDir)
	if err != nil {
		return err
	}
	if err := store.Initialize(); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	run, err := runner.NewDaemon(cfg, store).RunManual(ctx, *repoID, *ref, *sha)
	fmt.Printf("run %s: %s\n", run.ID, run.Status)
	return err
}

func findRepository(cfg *config.Config, id string) (config.Repository, bool) {
	for _, repo := range cfg.Repositories {
		if repo.ID == id {
			return repo, true
		}
	}
	return config.Repository{}, false
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func validRunIDPrefix(value string) bool {
	if len(value) == 0 || len(value) > 32 {
		return false
	}
	for _, character := range value {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}

func shortID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func truncate(value string, size int) string {
	if len(value) <= size {
		return value
	}
	if size < 4 {
		return value[:size]
	}
	return value[:size-3] + "..."
}

func printHelp() {
	fmt.Printf(`DiveeOI self-hosted CI runner %s

Commands:
  daemon --config config.json                    Poll Git refs and execute pipeline runs
  check --config config.json                     Validate config and Docker access
  validate --workflow .diveeoi/pipeline.yml      Validate a repository pipeline
  status --config config.json                    Show recent runs
  logs --config config.json <run-id>             Print a run log
  artifacts --config config.json <run-id>        List retained artifact file paths
  run --config config.json --repo ID --ref REF --sha SHA
                                                 Trigger a one-off run
  secret set --stdin --config config.json ID NAME
                                                 Encrypt a secret read from stdin
  secret list --config config.json ID            List secret names, never values
  secret delete --config config.json ID NAME     Remove a stored secret
  version                                         Print version

See tools/self-hosted-ci/README.md for installation, security boundaries, and configuration.
`, version)
}
