---
title: "I Wrote a Docker Env-Switcher. Then Compose Caught Up."
date: 2026-05-21
description: "Years ago I built a shell-script-based Docker Compose environment switcher. Recent Compose features quietly made most of that script unnecessary — here's the pattern that replaced it, driven by two environment variables and a thin wrapper file."
tags:
  - docker
  - docker-compose
  - podman
  - devops
  - containers
  - infrastructure
slug: compose-native-multi-environment
---

A while back, frustrated with the mess of juggling Docker Compose across local, staging, and production environments, I wrote a small shell-script tool — [`docker-compose-env-manager`](https://github.com/arikw/docker-compose-env-manager). You sourced it; it picked a row from a config file and set `COMPOSE_FILE`, `COMPOSE_ENV_FILES`, `DOCKER_HOST`, and a few related env vars in your current shell. From then on, `docker compose up` did the right thing for that environment.

It worked. I shipped it. Other people used variants of the same idea.

Then I went to refresh my memory on what Compose itself can do these days — and discovered that most of the work my script does has quietly become unnecessary. Compose has grown a set of primitives that, taken together, do almost everything the script did, declaratively, in YAML. The remaining shell wrapper is so small it barely qualifies as a script.

This post walks through the pattern I ended up with, what it can (and can't) do, and one gotcha that took me a while to untangle.

## The setup

We want a project that:

- Has a single entry point (`docker compose ...` from anywhere).
- Picks the right compose file(s) and `.env` file(s) per environment.
- Lets a new environment be added by dropping in a folder, with no edits to the entry point.

Here's the layout:

```text
poc/
├── compose.yml                                # thin wrapper at the root
└── infra/containers-config/
    ├── compose.yml                            # base service definition
    ├── compose.staging.yml                    # staging-specific overlay
    ├── .env                                   # defaults
    └── .env.staging                           # staging overrides
```

You run everything as:

```bash
COMPOSE_ENV=staging docker compose up
```

`COMPOSE_ENV` is the only knob. Change it to `production` and Compose loads a different overlay and a different env file — no code, no script.

## The wrapper

`poc/compose.yml` is the only file that knows about the variable:

```yaml
include:
  - path: infra/containers-config/compose.${COMPOSE_ENV}.yml
    env_file:
      - infra/containers-config/.env
      - infra/containers-config/.env.${COMPOSE_ENV}
```

Three things are happening here, all built into Compose v2.20+:

1. **Variable interpolation in the `include:` path.** `${COMPOSE_ENV}` is expanded at parse time, so the actual file being included depends on the variable.
2. **Layered env files** via `env_file:` inside the include. Compose loads them in order, later files override earlier ones.
3. **`env_file:` is established before the included file is parsed.** That means variables from `.env` and `.env.staging` are available for `${...}` substitution inside `compose.staging.yml` and its transitive includes.

## The overlay

`infra/containers-config/compose.staging.yml` adds environment-specific bits and pulls in the base:

```yaml
include:
  - compose.yml

services:
  app:
    environment:
      DEPLOY_ENV: staging
```

The include path here is relative to *this file's* directory (more on that in a minute), so it resolves to `infra/containers-config/compose.yml`.

## The base

`infra/containers-config/compose.yml` is the boring service definition, but it references variables instead of hard-coding values:

```yaml
services:
  app:
    image: nginx:alpine
    environment:
      APP_NAME: ${APP_NAME}
      DOMAIN: ${DOMAIN}
      API_URL: ${API_URL}
      DB_HOST: ${DB_HOST}
```

## The env files

The defaults file:

```bash
# .env
APP_NAME=poc-app
DOMAIN=example.com
API_URL=https://api.${DOMAIN}
DB_HOST=db.${DOMAIN}
```

The staging override:

```bash
# .env.staging
DOMAIN=staging.example.com
API_URL=https://api.${DOMAIN}
DB_HOST=db.${DOMAIN}
REGION=eu-west-1
LOG_GROUP=app-logs-${REGION}
```

Two things worth pausing on:

- **`.env.staging` overrides `DOMAIN`** and then *recomposes* `API_URL` and `DB_HOST` using the new value. That second-pass composition is essential — without it, `API_URL` keeps its base-file value of `https://api.example.com`.
- **`LOG_GROUP=app-logs-${REGION}`** references `REGION` defined one line above it, in the same file. Compose's env-file parser supports same-file forward references — but only forward. Reorder those two lines and `LOG_GROUP` becomes `app-logs-` with an empty suffix.

Running `COMPOSE_ENV=staging docker compose config` shows everything resolved:

```yaml
services:
  app:
    environment:
      API_URL: https://api.staging.example.com
      APP_NAME: poc-app
      DB_HOST: db.staging.example.com
      DEPLOY_ENV: staging
      DOMAIN: staging.example.com
      LOG_GROUP: app-logs-eu-west-1
      REGION: eu-west-1
    image: nginx:alpine
```

All three layers — base `.env`, staging override, staging compose overlay — merged correctly.

## The gotcha: `include:` is not `-f`

You might wonder: why bother with `include:` when `docker compose -f a.yml -f b.yml` has worked forever? They look equivalent, but they handle relative paths very differently.

I tested this with two minimal compose files in two sibling directories, each declaring `./data` as a bind mount source.

**With `-f dirA/compose.yml -f dirB/compose.yml`:**

| Service declared in | `./data` resolves to |
|---|---|
| `dirA/compose.yml` | `dirA/data` |
| `dirB/compose.yml` | `dirA/data` ⚠️ |

Both anchor to the **first `-f` file's directory**. The `-f` mechanism treats all listed files as fragments of one logical document with one project directory.

**With `include:` from a wrapper file:**

| Service declared in | `./data` resolves to |
|---|---|
| `dirA/compose.yml` | `dirA/data` |
| `dirB/compose.yml` | `dirB/data` |

Each included file has its **own base path** — the directory it lives in. Relative paths inside the file resolve against that base. This is exactly the property that makes `include:` suitable for reusable compose fragments: a snippet in `infra/containers-config/` can reference `./data`, `./scripts/init.sh`, or `build: ./api` and those references stay correct no matter who includes it.

Mental model:

- `-f` → "flatten N files into one before parsing paths" → single anchor.
- `include:` → "resolve paths in each file, then merge the resolved results" → N anchors.

If you've been reaching for `-f` chains to compose multi-environment stacks, switching to `include:` removes a whole class of "why is my volume pointing at the wrong directory" bugs.

## Driving the whole stack with environment variables

So far we've used one environment variable, `COMPOSE_ENV`, to pick a compose overlay and an env-file overlay in lockstep. The natural next step is to use a *second* environment variable to pick which Docker daemon the stack runs against. That variable is `DOCKER_HOST` (or `DOCKER_CONTEXT`); for a Podman-based stack it's `CONTAINER_HOST`. All three are read by the CLI when it connects to a daemon — they don't belong in YAML, but they're already a first-class part of how Docker is configured.

Selecting an environment then becomes a pair of exports:

```bash
# Staging on a remote Docker host via SSH
export COMPOSE_ENV=staging
export DOCKER_HOST=ssh://root@staging.example.com

# Production via a pre-defined Docker context
export COMPOSE_ENV=production
export DOCKER_CONTEXT=production-cluster

# Local Podman socket
export COMPOSE_ENV=dev
export CONTAINER_HOST=unix:///run/user/1000/podman/podman.sock
```

Each pair is a self-contained, per-shell selection: which environment's files and vars to load (`COMPOSE_ENV`), and which daemon to connect to (`DOCKER_HOST` / `DOCKER_CONTEXT` / `CONTAINER_HOST`). Two terminals open side-by-side can sit on completely different environments and completely different remote hosts without interfering — because shell environment is per-process.

This is the same conceptual model as [docker-compose-env-manager](https://github.com/arikw/docker-compose-env-manager): one named pick sets *both* the daemon target *and* the environment files in lockstep. The difference is what does the work:

- **The original project**: a shell script reads `compose.config`, picks a row like `staging=ssh://root@staging.example.com|./environments/staging`, then sets `DOCKER_HOST`, `COMPOSE_FILE`, `COMPOSE_ENV_FILES`, and a handful of other env vars in the current shell.
- **The Compose-native approach**: Compose itself handles compose file selection (`include:` with interpolation) and env file selection (`env_file:` inside `include:`). You're only responsible for setting `COMPOSE_ENV` and the daemon target — two variables.

You can still wrap that in a script if you want a picker, autocomplete, registry, or validation. But the script no longer needs to know anything about compose files, env files, or override semantics — it just sets two (or three) variables and gets out of the way. The irreducible wrapper is:

```bash
# pick-env.sh
case "$1" in
  staging)    export COMPOSE_ENV=staging    DOCKER_HOST=ssh://root@staging.example.com ;;
  production) export COMPOSE_ENV=production DOCKER_CONTEXT=production-cluster ;;
  dev)        export COMPOSE_ENV=dev        ;;  # local daemon
  *) echo "unknown env: $1" >&2; return 1 ;;
esac
```

That's the whole thing. Everything downstream — compose file resolution, env file layering, same-file interpolation, project naming, network prefixing — is Compose doing its job once those two variables are in scope.

## Day-to-day ergonomics

Two small additions make this setup pleasant to live with.

### A `dc` shorthand with tab completion

Typing `docker compose` for every command gets old. A one-line shell function plus a completion delegation gives you `dc ps`, `dc up -d`, `dc logs -f api`, and full tab completion — without maintaining a parallel completion definition:

```bash
# Docker
source <(docker completion bash)
dc() { command docker compose "$@"; }
complete -F __start_docker dc

# …or for Podman
source <(podman completion bash)
dc() { command podman compose "$@"; }
complete -F __start_podman dc
```

The first line sources the completion script that the CLI itself emits, which registers `__start_docker` (or `__start_podman`) as a bash function. The next two lines define `dc` as a thin wrapper and bind the same completion function to it — so `dc <TAB>` behaves identically to `docker <TAB>` (or `podman <TAB>`), without you having to maintain a parallel completion definition.

Note how thin this function is: it carries no environment-specific state. Older shell-script-based environment managers often shipped a more elaborate alias like `alias dc='COMPOSE_ENV_FILES=$X COMPOSE_FILE=$Y docker compose'` so that file selection happened inside the alias. That's no longer needed — the per-environment selection lives in `COMPOSE_ENV` and `DOCKER_HOST`, and Compose resolves files itself via the wrapper.

### VS Code terminal profiles for per-environment shells

The real payoff of doing this selection per-shell (rather than via global `docker context use`) is that you can have multiple terminals open simultaneously, each pointed at a different daemon and environment, with zero risk of one stomping on another. VS Code lets you make this visual and one-click: define a profile per environment in `.vscode/settings.json`, then spawn each from the terminal-dropdown.

```json
{
  "terminal.integrated.profiles.linux": {
    "🐳 Staging": {
      "path": "bash",
      "color": "terminal.ansiGreen",
      "icon": "vm-connect",
      "env": {
        "DOCKER_HOST": "ssh://staging.devbox.internal",
        "COMPOSE_ENV": "staging"
      }
    },
    "🐳 Production": {
      "path": "bash",
      "color": "terminal.ansiRed",
      "icon": "vm-connect",
      "env": {
        "DOCKER_HOST": "ssh://production.devbox.internal",
        "COMPOSE_ENV": "production"
      }
    }
  }
}
```

(Use `terminal.integrated.profiles.osx` or `terminal.integrated.profiles.windows` on other platforms.)

The `env` block is exactly the two-variable selection from the previous section, baked into the profile so you never have to type the exports. The colors — `ansiGreen` for staging, `ansiRed` for production — make it nearly impossible to fire `dc down` in the wrong terminal. Open two side-by-side and you have per-shell isolation that global Docker contexts simply can't match: each terminal owns its own `DOCKER_HOST` and `COMPOSE_ENV`, with no shared state to leak between them.

## When to use which

For purely local multi-env work (dev / test / lint setups), just `export COMPOSE_ENV=...` and run. Drop in a new `compose.NAME.yml` and `.env.NAME` and you're done — no script, no tool, no global state.

For remote deployments across multiple Docker hosts, pair `COMPOSE_ENV` with `DOCKER_HOST` / `DOCKER_CONTEXT` / `CONTAINER_HOST`. You can do this manually with two `export` lines, with a tiny project-specific script, with [`direnv`](https://direnv.net/) per directory, or with a `.envrc` per worktree — whatever fits your shell habits. The point is that the orchestration logic is gone; what remains is just *setting variables*.

The compose primitives finally got good enough that "manage Docker Compose environments" can stop being a category of tool and start being a folder layout convention plus two environment variables.
