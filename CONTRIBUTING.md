# Contributing to SPECTER

## Branch Strategy

```
main        →  active development; all feature work merges here
staging     →  deployed to staging (Sepolia testnet); gates QA before production
production  →  production (Ethereum mainnet); protected, requires review + approval
```

**Flow:**

```
feat/my-feature  ──PR──▶  main  ──PR──▶  staging  ──PR──▶  production
```

- Every feature or fix starts from a branch off `main`.
- `staging` and `production` are updated only via pull requests — never direct pushes.
- `production` requires at least one approved review and green CI before merge.
- Tag releases on `production`: `git tag v1.2.3 && git push origin v1.2.3`

## Branch Naming

```
feat/add-ml-kem-1024
fix/ens-resolution-timeout
chore/bump-viem-2.22
docs/update-api-reference
ci/add-cargo-deny
refactor/scanner-view-tag-loop
test/yellow-channel-lifecycle
```

## Commit Message Format

SPECTER uses [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <short description>

[optional body]

[optional footer: BREAKING CHANGE, closes #issue]
```

**Types:**

| Type       | When to use                                     |
|------------|-------------------------------------------------|
| `feat`     | New feature or capability                        |
| `fix`      | Bug fix                                          |
| `chore`    | Dependency bumps, tooling, build changes         |
| `docs`     | Documentation only                              |
| `refactor` | Code change with no behaviour change             |
| `test`     | Adding or fixing tests                          |
| `ci`       | CI/CD workflow changes                           |
| `perf`     | Performance improvement                         |
| `security` | Security fix or hardening                       |

**Scopes (optional but recommended):**
`crypto`, `api`, `scanner`, `registry`, `ens`, `suins`, `yellow`, `ipfs`, `cli`, `web`, `ci`

**Examples:**

```
feat(crypto): add ML-KEM-1024 key size option
fix(ens): handle ENS names with trailing dot
chore(deps): bump viem to 2.22.0
docs: add Yellow Network integration guide
ci: add frontend build workflow
security(api): tighten CORS allowed origins
refactor(scanner): simplify view tag batch loop
test(registry): add Turso connection retry tests
```

## Pull Request Checklist

Before opening a PR:

- [ ] `cargo fmt --all` passes (Rust)
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` passes
- [ ] `cargo test --workspace` passes
- [ ] `npm run lint` passes (frontend)
- [ ] `npx tsc --noEmit` passes (frontend)
- [ ] No `.env` files or secrets committed
- [ ] New env vars added to the relevant `.env.*.example` files
- [ ] README updated if public API or env vars changed

## Environment Files

Never commit real `.env` files. Use the example files as templates:

| File | Purpose |
|------|---------|
| `specter/.env.example` | Local development defaults |
| `specter/.env.staging.example` | Staging (Sepolia testnet, staging Turso DB) |
| `specter/.env.production.example` | Production (mainnet, production Turso DB) |
| `SPECTER-web/.env.example` | Local frontend defaults |
| `SPECTER-web/.env.staging.example` | Staging frontend |
| `SPECTER-web/.env.production.example` | Production frontend |

Copy the relevant example file and fill in real values:

```bash
cp specter/.env.staging.example specter/.env
```

## Security Vulnerabilities

Report privately to **hello@pranshurastogi.com** — do not open a public issue.
