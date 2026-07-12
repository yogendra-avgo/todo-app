---
name: add-cicd-task
description: This skill should be used when the user wants to add, change, or debug a step in this repo's CI/CD pipeline — anything touching .github/workflows/ci.yml, release.yml, or a ci:*/cd:* task in Taskfile.yml. Also applies to "add a build step", "add a CI check", "change what happens on tag/push", or "why did the CI task fail".
---

# Adding/changing a CI/CD task in todo-app

This repo keeps CI/CD *logic* in `Taskfile.yml` as `ci:`/`cd:`-prefixed tasks, and keeps
`.github/workflows/*.yml` as thin orchestration that just calls those tasks. Do not put
real logic (multi-line scripts, docker/git commands) directly in workflow YAML, and do not
add standalone `scripts/*.mjs`/`*.sh` files for CI steps — a prior version of this pipeline
did that and it was deliberately removed in favor of Taskfile tasks (testable locally with
just `task`, no Node/CI context required).

All buildable application source (web app + `locust/`) lives under `app/`. `.github/workflows/ci.yml`
only triggers on `app/**` changes — this is deliberate, so that PRs touching only `k8s/**`
(e.g. the auto-bump PR `cd:bump-k8s-images` opens) don't re-trigger a build/tag/release loop.
Keep that boundary: anything meant to gate CI should live under `app/`; anything CI must
*not* react to (k8s manifests, docs, this Taskfile/workflow config itself) should not.

## Steps

1. **Write the task first**, prefixed `ci:` if it belongs to `ci.yml` (runs on every
   `app/**` push) or `cd:` if it belongs to `release.yml` (runs on a release tag). Read
   parameters from environment variables (`CI_*` prefix), not Task template vars, so the
   same task works identically whether invoked from a workflow `env:` block or by hand
   (`CI_IMAGE_TAG=v1 task cd:build-push`). Use shell idioms for validation/defaults:
   - Required: `: "${CI_FOO:?CI_FOO env var is required, e.g. ...}"`
   - Optional with default: `"${CI_FOO:-some-default}"`
2. **Factor shared logic** across near-identical tasks (e.g. building the app image vs. the
   locust image) into an `internal: true` helper task, called via `task: cd:_helper` with
   a `vars:` block for the parts that differ. See `cd:_build-push` for the pattern.
3. **Docker layer caching**: any `docker buildx build` in a `ci:`/`cd:` task should use
   `--cache-from type=gha,scope=<name> --cache-to type=gha,mode=max,scope=<name>`. Give each
   distinct build target (app image, locust image, smoke-test image) its own `scope` so they
   don't thrash each other's cache. Build contexts are `app/` (web app) and `app/locust/`
   (locust) — not `.`.
4. **Wire it into the workflow** — add a step to `ci.yml` or `release.yml`, as a one-liner:
   ```yaml
   - name: <human description>
     run: task ci:<name>   # or cd:<name>
     env:
       CI_FOO: <value>
   ```
5. **Validate before calling it done**, all cheap and offline:
   ```bash
   python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); yaml.safe_load(open('.github/workflows/release.yml')); yaml.safe_load(open('Taskfile.yml'))"
   task --list-all | grep -E 'ci:|cd:'   # confirm it registers (internal tasks are hidden)
   CI_FOO=bar task --dry ci:<name>       # confirm the rendered command looks right
   ```
   For tasks that mutate files (like `cd:bump-k8s-images`), test the actual `sed`/patch
   logic against a scratch copy of the real files before trusting `--dry`.

## Current pipeline shape (for context, may drift — read the files to confirm)

- `ci.yml` (triggers on `app/**` push only): `smoke-test` job → `tag-release` job (main
  only, on success) tags `v<run_number>` and dispatches `release.yml`.
- `release.yml` (triggers on tag push / dispatch): builds+pushes `ghcr.io/yogendra-avgo/todo-app`
  and `-locust` images from `app/` and `app/locust/`, then `cd:bump-k8s-images` opens a PR
  bumping `k8s/04-app/*.yaml` image tags.
