# Repository commit hook

Enable this tracked hook after cloning:

```sh
git config --local core.hooksPath .githooks
```

`commit-msg` appends one `Co-authored-by: DiveeAgent <270451464+DiveeAgent@users.noreply.github.com>` trailer to every commit message. It is idempotent, including when a commit is amended.
