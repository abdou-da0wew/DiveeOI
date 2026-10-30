package gitremote

import (
	"os"
	"strings"

	"github.com/abdou-da0wew/DiveeOI/tools/self-hosted-ci/internal/config"
)

var gitPassthroughEnv = []string{
	"PATH", "HOME", "TMPDIR", "SSH_AUTH_SOCK", "GIT_SSH_COMMAND",
	"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
	"http_proxy", "https_proxy", "all_proxy", "no_proxy",
	"SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "GIT_SSL_CAPATH",
}

func gitEnvironment(credentials *config.GitCredentials, values map[string]string) []string {
	result := make([]string, 0, len(gitPassthroughEnv)+len(values))
	for _, name := range gitPassthroughEnv {
		if credentials != nil && name == credentials.TokenEnv {
			continue
		}
		if value, ok := os.LookupEnv(name); ok {
			result = append(result, name+"="+value)
		}
	}
	for name, value := range values {
		result = replaceEnvironment(result, name, value)
	}
	return result
}

func replaceEnvironment(environment []string, name, value string) []string {
	prefix := name + "="
	for index, item := range environment {
		if strings.HasPrefix(item, prefix) {
			environment[index] = prefix + value
			return environment
		}
	}
	return append(environment, prefix+value)
}
