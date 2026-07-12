# Simple TODO App

[![CI](https://github.com/yogendra-avgo/todo-app/actions/workflows/ci.yml/badge.svg)](https://github.com/yogendra-avgo/todo-app/actions/workflows/ci.yml)
[![Release](https://github.com/yogendra-avgo/todo-app/actions/workflows/release.yml/badge.svg)](https://github.com/yogendra-avgo/todo-app/actions/workflows/release.yml)
[![Container: GHCR](https://img.shields.io/badge/ghcr.io-yogendra--avgo%2Ftodo--app-blue?logo=github)](https://github.com/yogendra-avgo/todo-app/pkgs/container/todo-app)
[![Node](https://img.shields.io/badge/node-18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/postgres-15-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

A minimal server-rendered TODO app (Express + htmx + PostgreSQL) used as a demo/test workload
for VKS app-engineering exercises: container builds, CI/CD, Prometheus metrics, load
testing with Locust, and Velero backup/DR.

![ui](demo-intro.png)

## Features

- CRUD todo list rendered server-side with [htmx](https://htmx.org/) (no client-side JS framework)
- PostgreSQL-backed storage, with `/api/todos/seed` and `/api/todos/clean` helper endpoints for demos
- `/healthz` liveness/readiness endpoint and a Prometheus `/metrics` endpoint (see `app/metrics.js`)
- Optional `BASE_PATH` env var so the app can be reverse-proxied under a subpath (e.g. behind a Gateway API route)
- [Locust](https://locust.io/) load-testing setup (`app/locust/`) for generating traffic during demos
- Kubernetes manifests (`k8s/`) covering namespace/app bootstrap, Istio Gateway/VirtualService, and Prometheus PodMonitor/ServiceMonitor
- Velero backup/restore `task` commands for PROD → DR failover demos

## Project Layout

- `app/` — the buildable/publishable application source: the web app (`server.js`,
  `metrics.js`, `static/`, `package.json`, `Dockerfile`) and `app/locust/` (its own
  Dockerfile + `locustfile.py`). CI only triggers on changes under this directory.
- `k8s/` — Kubernetes manifests, updated by a bot-opened PR after each release, not by CI.
- `Taskfile.yml` — every dev/CI/CD command, runnable locally with `task <name>`.

## Tech Stack

- **App**: Node.js 18, Express, htmx, Pico CSS
- **Database**: PostgreSQL 15
- **Container**: Docker (multi-stage build), multi-arch (`linux/amd64`, `linux/arm64`)
- **Orchestration**: Kubernetes, Istio Gateway/VirtualService
- **Observability**: Prometheus (PodMonitor/ServiceMonitor)
- **Backup/DR**: Velero
- **CI/CD**: GitHub Actions + [go-task](https://taskfile.dev/) → [ghcr.io/yogendra-avgo/todo-app](https://github.com/yogendra-avgo/todo-app/pkgs/container/todo-app)

## Prerequisites

- [Docker](https://www.docker.com/) (with buildx)
- [go-task](https://taskfile.dev/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Node.js](https://nodejs.org/) 18+

## Local Development

```bash
cp .env.sample .env   # fill in registry/cluster values for your environment

task dev:up           # build & start app + postgres via docker compose
task dev:down         # tear down the local stack
task dev:reboot       # down + up
```

The app is served at http://localhost:3000, backed by a local Postgres container.
Useful data helpers: `task dev:show-data`, `task dev:clean-data`, `task dev:db-shell`.

Run `task --list` to see every available task (dev, ci, cd, prod, dr, init).

## CI/CD

Two workflows: one pure CI (`ci:*` tasks), one pure CD (`cd:*` tasks) — both defined in
[`Taskfile.yml`](Taskfile.yml). CI only runs when `app/**` changes, so merging a PR that
only touches `k8s/**` (e.g. the auto-bump PR below) never re-triggers a build/tag/release.

**[`ci.yml`](.github/workflows/ci.yml)** — on every push that touches `app/**`:
1. `smoke-test`: installs dependencies and runs `task ci:smoke-test`, which builds the
   image and boots it against a throwaway Postgres container to verify `/healthz` responds.
2. `tag-release` *(main only, after smoke-test passes)*: tags the commit `v<run number>`
   (e.g. `v42`) — a short, always-increasing, collision-free tag — pushes it, and dispatches
   `release.yml` for that tag.

**[`release.yml`](.github/workflows/release.yml)** — on a pushed tag, or dispatched by
`ci.yml`:
1. Builds & pushes multi-arch images to
   [`ghcr.io/yogendra-avgo/todo-app`](https://github.com/yogendra-avgo/todo-app/pkgs/container/todo-app)
   and `ghcr.io/yogendra-avgo/todo-app-locust`, tagged with the release tag and `latest`,
   using `task cd:build-push` / `task cd:build-push-locust`.
2. Opens a PR (`task cd:bump-k8s-images`) bumping the image tags in `k8s/04-app/*.yaml` to
   the new release tag, for review before merging to production manifests.

Merging an `app/**` change to `main` is enough to cut a release — no manual tagging needed.
To trigger a release for an existing commit by hand: `gh workflow run release.yml -f tag=v42`.

## Infra Setup

1. Create namespace
2. Create ArgoCD instance
3. Create cluster
4. Create namespace
5. Add cluster to ArgoCD

## App Onboarding

1. Create app
2. Add cluster to ArgoCD
3. Add app to ArgoCD
