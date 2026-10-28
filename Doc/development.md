# dsh-mcp-mgr Source Developer Guide

English | [中文](development.zh.md)

Use this workflow when modifying both deepseek-harness and this plugin from source. The two repositories may be anywhere; they do not need to be siblings or use fixed paths.

## 1. Configure the harness source once

Replace the placeholder with the absolute path of the deepseek-harness source checkout and run this once:

```powershell
[Environment]::SetEnvironmentVariable('DSH_HARNESS_ROOT', '<deepseek-harness-source-root>', 'User')
```

Open a new terminal afterwards. This variable is used only by local profile install/uninstall; it is not used by this repository's build or regression commands.

## 2. Build this plugin

```powershell
Set-Location '<dsh-mcp-mgr-source-root>'
pnpm install
pnpm run check
```

`check` includes the host/client builds, Typert generation, and `verify` regression.

## 3. Build the harness, install the local plugin, and start the source Web

Install dependencies and build deepseek-harness first:

```powershell
Set-Location $env:DSH_HARNESS_ROOT
pnpm install
pnpm run build
```

Then return to the plugin source root and run:

```powershell
Set-Location '<dsh-mcp-mgr-source-root>'
pnpm run profile:add
```

The command invokes the official source CLI through `DSH_HARNESS_ROOT` and dynamically passes the host/UI package directories from the current checkout. It does not depend on a fixed path.

Finally, start the source Web profile:

```powershell
Set-Location $env:DSH_HARNESS_ROOT
pnpm dsh web
```

Go to Settings > Plugins and check the MCP server tab.

## 4. Local regression

This repository's build and regression commands do not require the harness source checkout:

```powershell
Set-Location '<dsh-mcp-mgr-source-root>'
pnpm run check
pnpm exec node e2e/e2e.mjs
pnpm exec node e2e/apply-remove-settle.mjs
```

Expected markers: `ALL PASS`, `E2E PASS`, and `SETTLE PASS`.

## 5. Remove the local profile entries

Stop the Web process first, then run from the plugin source root:

```powershell
pnpm run profile:remove
```

## Releases

Publishing is driven by the tag: a pushed `vX.Y.Z` tag is the only way a version reaches npm, so a release cannot half-happen.

1. Bump `version` in both `packages/dsh-mcp-mgr/package.json` and `packages/dsh-mcp-mgr-ui/package.json` (plus the two inter-package pins), run `pnpm install` to refresh the lockfile, and commit.
2. Tag and push the tag: `git tag -a vX.Y.Z -m "vX.Y.Z"` then `git push --follow-tags` (a plain `git push` does not push tags).
3. `.github/workflows/release.yml` installs, runs `pnpm run check`, publishes `dsh-mcp-mgr-ui` before `dsh-mcp-mgr` with `--provenance`, verifies both packages, and creates the GitHub release.

A prerelease tag (`vX.Y.Z-rc.1`) publishes under the `next` dist-tag and as a GitHub prerelease, so `latest` stays on the stable line. Run the workflow manually (Actions → release → Run workflow) to exercise install, build, and the regression on the runner without publishing anything — do that once before the first real release.

One-time setup, once per package (npmjs.com → the package → Settings → Trusted publishing → GitHub Actions): owner `yangfch3`, repository `dsh-mcp-mgr`, workflow filename `release.yml`, environment left blank. No npm token or repository secret is stored — the `id-token: write` permission authenticates the publish through OIDC and also produces the provenance attestation. The job stops before publishing when the tag does not equal both package versions; versions already on the registry are skipped, so a failed run can be re-run safely.

Two npm behaviours to respect: a trusted publishing configuration that has not published yet expires after 48 hours (recreate it if you miss the window), and with no token stored a local `npm publish` no longer authenticates — publishing only happens in CI. If you ever must publish by hand, npm only offers write access as a granular token with **Bypass 2FA** enabled, and write tokens expire within 90 days.

Both `package.json` files must keep their `repository` field pointing at this repo: npm validates it against the provenance bundle and rejects the publish with `422 Unprocessable Entity - Error verifying sigstore provenance bundle` when it is missing or names a different repository.

## Build commands

Run all commands from this repository root:

```powershell
pnpm install
pnpm run build
pnpm run verify
```

`build`, `gen.mjs`, and `verify.mjs` use the published npm dependencies and do not require `DSH_HARNESS_ROOT` or a deepseek-harness source checkout. Only `profile:add` and `profile:remove` use that variable to invoke the official source CLI.

After changing wire types in `src/types.ts`, rerun `pnpm run build` so the generated Typert artifacts and client codec stay synchronized.

Placeholder meanings:

- `<deepseek-harness-source-root>`: the root directory of the deepseek-harness source checkout.
- `<dsh-mcp-mgr-source-root>`: the root directory of this plugin source checkout.

See the [design notes](requirements.md) for implementation details.
