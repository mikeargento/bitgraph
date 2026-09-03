# Moving the npm scope

Status: proposal. **Nothing is renamed.** Written 2026-09-03 at Mike's request (task 7 of the
homepage revision brief). No package name, `package.json`, import path, or published artifact is
changed by this document.

## The problem this addresses

Every package publishes under `@mikeargento/`, on a site that closes with "Argento Computing Inc."
and states that patents are pending. To an enterprise evaluator, a personal npm scope reads as a
side project. That is a signalling problem, not a technical one, and it is worth fixing carefully
rather than quickly.

## The constraint that governs everything below

Verification must never break, and must never become something a person needs permission to do.
Four of the five packages are the verification path:

| Package | Licence | Role |
|---|---|---|
| `@mikeargento/bitgraph-verify` | MIT | Verifies canonical form, signature, slot binding |
| `@mikeargento/bitgraph-audit` | MIT | Bundle ingest, Nitro attestation chain to the AWS root |
| `@mikeargento/bitgraph-player` | MIT | Offline rule evaluation, `bitgraph-check/1` reports |
| `@mikeargento/bitgraph-mcp` | MIT | The same operations from an MCP client |
| `@mikeargento/bitgraph` | Proprietary, with an irrevocable verification grant | The SDK and CLI that issue proofs |

An install line printed in a proof bundle, a docs page, a blog post, or a customer's CI file must
keep working forever. That rules out unpublishing anything, and it rules out any migration that
requires a reader to know which name is current.

## Which scope to claim

Recommendation: **`@bitgraph`**, with `@argento` registered defensively and left unused.

- `@bitgraph` matches the product, the domain, the trademark application, and the name a developer
  will guess. Nothing in the packages is named after the company.
- `@argento` matches the legal owner, but the owner is deliberately invisible everywhere else on the
  site. Introducing it in install lines would raise a question the packages do not otherwise raise.
- Verify availability on the registry before anything else. If `@bitgraph` is taken, the next choice
  is `@bitgraph-protocol`, not `@argento`.

## The sequence

Each step is independently reversible up to step 5.

1. **Claim the scope.** Create the npm org, add the publishing account, enable 2FA on the org. No
   packages published. Reversible: delete the org.
2. **Dual publish, verification packages only.** Publish the four MIT packages under both scopes at
   the same version, from the same tarball, in the same release. `@bitgraph/bitgraph-verify` is
   redundant naming, so the new names drop the prefix: `@bitgraph/verify`, `@bitgraph/audit`,
   `@bitgraph/player`, `@bitgraph/mcp`. Both scopes stay current for at least two minor releases.
   Reversible: stop publishing the new names.
3. **Point the documentation at the new names.** Site, READMEs, the proof bundle's own README if it
   names a package. Old names still work and still resolve; nothing tells a reader they are wrong.
4. **Deprecate the old names, do not unpublish.** `npm deprecate @mikeargento/bitgraph-verify@"*"`
   with a message naming the new package. A deprecation is a console warning on install. It never
   breaks a build, never removes a version, and never invalidates a lockfile. This is the only
   acceptable form of "removal" for a verification package.
5. **The core last, and only if it moves at all.** `@mikeargento/bitgraph` is the SDK that issues
   proofs, so its audience is licensees rather than the public. It has the smallest install base and
   the least urgency. Moving it after the verification packages have settled keeps the risky change
   away from the path that must never break.

Do not run steps 2 and 5 in the same release.

## Every place the scope is hardcoded

Found by `grep -rn "@mikeargento/" --include='*.ts' --include='*.tsx' --include='*.md' --include='*.json'`
from the repository root. Re-run it before executing any step; this list is a snapshot.

- **Package manifests.** The `name` field of each package, and the `dependencies` entries that link
  them: the root package depends on verify and audit, mcp depends on the core, player depends on
  verify.
- **Source imports.** Every `import ... from "@mikeargento/bitgraph-verify"` across the core, the
  site, the packages, and their tests.
- **The website.** The home page's install lines and package rows, `/docs/integration`,
  `/docs/audit`, `/docs/player`, `/docs/mcp`, `/docs/verification`, and the hosted MCP route's tool
  descriptions.
- **READMEs**, one per package, plus the repository README.
- **The MCP servers.** The stdio package's own name in its server info, and the hosted route's
  description text, which names the stdio package as an alternative.
- **The lockfile**, which regenerates.

## Rollback

Before step 4 there is nothing to roll back: both names exist and both work. After step 4, undo a
deprecation with `npm deprecate <pkg>@"*" ""`, which clears the message. Nothing in this plan
unpublishes a version, so no dependent install can ever fail because of it.

The one irreversible act is claiming the org name, which costs nothing to hold.

## What this plan deliberately does not do

- No unpublishing, ever.
- No `npm dist-tag` games. A tag that points the old name at the new package would silently change
  what a lockfile resolves to.
- No wrapper packages that re-export the new package under the old name. That doubles the supply
  chain surface on the verification path, which is the one place that must stay boring.
- No change to the proof format, the enclave, or anything a published proof carries. A proof does
  not name a package, and nothing here would change if it did.
