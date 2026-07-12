---
name: cut-release
description: This skill should be used when the user wants to "cut a release", "publish a new image", "tag a release", "deploy the latest build", or asks how the todo-app release/tagging process works.
---

# Cutting a release of todo-app

## Normal path (fully automatic)

Merge to `main`. Once `test.yml`'s smoke-test job passes on `main`, its `tag-release` job:

1. Tags the commit `v<github.run_number>` (e.g. `v42` — always increasing, no manual
   input, no collisions).
2. Pushes that tag.
3. Explicitly runs `gh workflow run release.yml -f tag=v<N>` (a plain tag push from
   `GITHUB_TOKEN` does *not* self-trigger another workflow — GitHub's loop-prevention — so
   the dispatch is done explicitly instead of relying on the tag-push trigger).

`release.yml` then:

1. Builds & pushes multi-arch (`amd64`/`arm64`) images to
   `ghcr.io/yogendra-avgo/todo-app:v<N>` and `ghcr.io/yogendra-avgo/todo-app-locust:v<N>`
   (plus updating `:latest` on both).
2. Opens a PR (`task cicd:bump-k8s-images`) that bumps the image tags in
   `k8s/04-app/01-app.yaml` and `k8s/04-app/03-locust.yaml` to `v<N>`.
3. **That PR needs a human to review and merge** — it does not auto-merge. Nothing is
   actually deployed to the cluster until this PR lands and whatever applies `k8s/` runs.

## Manual path (release an arbitrary commit/tag without waiting for `main`)

```bash
gh workflow run release.yml -f tag=v99   # or any tag string
```

or push a tag directly (also works, since `release.yml` listens on `push: tags: ['*']`):

```bash
git tag v99 && git push origin v99
```

## Things to check if something looks wrong

- **403 pulling the image**: GHCR packages default to *private* on first push. Flip
  `todo-app` / `todo-app-locust` to public in the repo's package settings on GitHub, or add
  a pull secret to the k8s deployments (`imagePullSecrets` was removed from
  `k8s/04-app/01-app.yaml` on the assumption the packages are public).
- **Release ran but the PR never showed up**: check the `release.yml` run logs for the
  "Open PR bumping k8s image tags" step — `cicd:bump-k8s-images` no-ops (exits 0, no PR)
  if the image tags in `k8s/04-app/*.yaml` are already at that version.
- **Tag pushed but nothing happened**: confirm it went through `test.yml`'s `tag-release`
  job (only runs for pushes to `main`) or was dispatched by hand — a tag pushed by a human
  via `git push` should still fire `release.yml` directly via its `push: tags` trigger.
