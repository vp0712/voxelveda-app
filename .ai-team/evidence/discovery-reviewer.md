# Independent setup inspection

Inspected at **2026-11-22 14:42:50 UTC** by actual host agent
**`/root/vv_reviewer`**, explicitly loading the installed
`.codex/agents/vv-reviewer.toml:1`. The coordinator remains the main conversation.
The host spawn inherited its parent's model without an override. This is real
specialist execution through the available collaboration tool with manual
role-file loading; it does not establish automatic custom-role registry discovery.

Repository: `/workspace/voxelveda-app`, origin `vp0712/voxelveda-app`.
Inspected branch: `setup-voxel-veda-ai-team-20261122`.
Application baseline: `75ee8ffc0b46077a2a9de488d566ca8f0bc0f0ab`.

Read first: `AGENTS.md:1`, `.ai-team/TEAM.md:1`, `.ai-team/ROSTER.md:1`, and the
installed reviewer role. Root owns all setup/configuration work and `WORK.md`;
this reviewer writes only this evidence file.

## Observed setup checks

| Check | Observed result |
| --- | --- |
| Selected attachment payload integrity | All 739 common files and 84 Codex files match the attachment manifest SHA-256 entries at inspection time; zero mismatches. |
| Installed role inventory | 84 unique TOML role names: 72 `ecc-*` and 12 `vv-*`. |
| Model and permission configuration | All role TOMLs contain only `name`, `description`, and `developer_instructions`; no model, sandbox, approval, or permission override fields. |
| Reference recipes | 328 direct `skills/*/SKILL.md` files under `.ai-team/ecc-reference/`. |
| Existing tracked application files | `git diff --name-only HEAD` was empty at inspection time; application source, dependencies and release marker were unchanged. |
| Original instruction preservation | The new root `AGENTS.md` contains the owned team guidance block. The current application README remains unchanged. |
| Actual Node secret scanner | Attempted read-only; exited 1 because this sandbox rejected `spawnSync git` with `EPERM`. This is a host execution blocker, not a scanner PASS or proof of an application defect. |
| Read-only scanner-rule reproduction | A Python mirror of the current assignment rule found 13 documented upstream example assignments in the newly installed references/role. These are example placeholders, not observed real credentials. |

The coordinator's initial original-installer `--check` PASS occurred before the
mutable task log was populated. The integrity count above independently re-read
the installed bytes rather than relying on that reported earlier run.

## Findings

1. **P1 — Resolve setup compatibility before claiming normal CI passes.**
   `scripts/source-file-inventory.js:9` includes cached and untracked hidden
   project files; its Git-less packaged-source fallback at line 13 also includes
   the installed references. `scripts/secret-scan.js:16` and line 30 reject
   credential-like assignments not recognized by the placeholder pattern at
   line 17. The reference examples therefore introduce 13 deterministic matches
   under that rule, including
   `.codex/agents/ecc-opensource-forker.toml:138` and line 143, and
   `.ai-team/ecc-reference/agents/opensource-forker.md:135` and line 140.
   Additional matching examples are in `deployment-patterns/SKILL.md:338`,
   `django-security/SKILL.md:581` and line 587, `docker-patterns/SKILL.md:27`,
   `flox-environments/SKILL.md:61` and line 374,
   `laravel-security/SKILL.md:837`, and `prisma-patterns/SKILL.md:238` and line 241.
   These paths are relative to `.ai-team/ecc-reference/skills/` where applicable.
   `scripts/application-regression-suite.js:62` invokes this scanner, so the issue
   affects the normal build/regression path. Confirm the actual scanner in the
   coordinator's permitted execution context. Preserve pinned payload bytes and
   credential detection; avoid blanket exclusion of agent/reference directories.
   Any narrow example handling must still reject arbitrary non-placeholder
   credentials in a modified reference or agent file.

2. **P2 — Treat the task log as mutable when documenting repeat checks.**
   The attachment's `install-team.py:79` compares every installed payload file
   byte-for-byte, including the template `.ai-team/WORK.md:1`. Writing the
   user-required verified task state there necessarily makes a later original
   installer check/reinstall report a collision. Keep the completed log rather
   than restoring its empty template. Record the initial check separately and
   independently verify every immutable payload hash afterward; do not describe
   a later original-installer check as passing if it rejects the edited log.

3. **Activation gap — automatic native discovery is still unverified.**
   The coordinator's standalone Codex CLI attempt stopped at token refresh
   before worker spawning and requires a fresh secure client sign-in. The
   current collaboration host has no custom-role-type selector, so this
   inspection explicitly loaded the installed reviewer file. Native plugin-list
   installation/enabled state, hook trust, native role auto-discovery and actual
   model execution are distinct observations. No hook trust or sandbox bypass
   was used by this reviewer.

## Application and verification entry points

| Area | Existing entry/reference |
| --- | --- |
| Normal Node application | `package.json:9` starts `server.js`; the dependency stack includes Express and MySQL. |
| Startup and workers | `server.js:233` starts email, weekly-timesheet and workflow workers; line 234 starts procurement import; line 248 opens the HTTP listener. |
| Canonical origin and routing | `app.js:35` applies canonical-origin handling; line 44 defines health/readiness; lines 71 and 75–77 select authenticated role portals; line 120 mounts auth APIs. |
| Railway gateway | `scripts/railway-startup-gateway.js:122` spawns the existing `server.js`; line 146 opens the public gateway. |
| Native application | `capacitor.config.json:2` retains `com.voxelveda.app`; line 6 uses `https://app.voxelveda.com` with cleartext disabled. |
| Syntax check | `package.json:10` and `scripts/check-syntax.js:15`; the scanner enumerates eight explicit application directories and does not execute vendored reference scripts. |
| Regression/build | `package.json:13` and line 14 invoke the explicit regression suite and syntax check. |
| Dependency/security checks | `package.json:17` and line 18; `scripts/security-source-test.js:13` independently checks repository source boundaries. |
| Candidate verification | `.github/workflows/application-release-ci.yml:31` runs UTC, line 35 Melbourne, and line 45 packaged-source builds. |
| Real disposable database verification | `.github/workflows/integrated-repair.yml:9` defines the MySQL fixture job; lines 45–50 exercise retained schema/records and complete registers. |
| Release boundary | `.github/workflows/production-account-verification.yml:30` requires an actual release-marker change; line 66 verifies the exact deployed revision and public pages. `.railway-release:1` is unchanged by setup. |

## Minimal recommended verification

- Preserve the recorded original installer dry-run/install/initial `--check`
  results. Recheck all immutable selected payload hashes, 84 TOML definitions,
  328 recipes and the owned instruction block after writing `WORK.md`.
- Run `npm run check`, `npm run security:secrets`,
  `node scripts/security-source-test.js`, and
  `node scripts/source-file-inventory-test.js` in an execution context where
  Node may spawn the required local processes. Confirm narrow example handling
  without weakening real-secret detection or the packaged-source scan.
- If changes are published, use the repository's existing candidate checks.
  Agent configuration alone does not require changing the production marker,
  starting the application against production, sending email or publishing an
  Android build.
- After the standalone Codex client is securely reauthenticated, open this
  actual repository and repeat the native parallel `vv-planner`/`vv-reviewer`
  spawn check, recording actual native role names and agent IDs. Finish any
  required native hook-trust action through the client.

No dependency installation, application/build execution, Git/provider mutation,
production read, email, or application-file edit was performed by this reviewer.
The Node scanner attempt and independent in-memory/hash checks above are the
only checks claimed here. Physical-device, inbox, deployment and store outcomes
are outside this setup inspection.

## Post-integration independent review

Re-inspected the working-tree integration at **2026-11-22 14:49:46 UTC** as
`/root/vv_reviewer`, using the same installed reviewer role and inherited model.
The earlier findings above describe the initial installation. The scoped repair
and mutable-log verifier below address those setup issues in code; the
coordinator's actual Node/build runs remain separate required evidence.

**Review result: no blocking security-coverage or payload-preservation defect
identified in the integrated changes inspected.**

- `scripts/secret-scan.js:7` retains the original high-confidence signature
  patterns, and lines 14–15 retain the original protected-assignment expression
  and placeholder semantics. Lines 17–30 separate detection without changing
  those checks. At line 36, only `hardcoded-*` findings can reach the reviewed
  example exemption; private-key, AWS, GitHub, Slack and Stripe signatures remain
  in the failure result. Diagnostics at line 37 retain only path/line/kind.
- `scripts/ai-team-reference-examples.js:11` defines eight exact relative paths.
  Lines 46–51 require an own path key, original `Buffer` bytes, a positive integer
  line, an exact finding kind and a full raw-byte SHA-256 match. Unlisted/new/app
  paths, changed bytes, text normalization, another line or another kind cannot
  inherit an exception. The list does not create a directory-wide exclusion.
  An independent Python inspection compared every one of the eight literal
  file pins with the original attachment manifest and counted exactly thirteen
  hardcoded-assignment line/kind pins; all matched the original supplied bytes.
- `scripts/ai-team-secret-scan-test.js:39` exercises the real detector and filter
  for all eight files. Lines 48–70 cover path aliases, application/unreviewed
  paths, line/kind/type changes, arbitrary byte and invalid-UTF-8 changes,
  prepended/appended credentials and high-confidence signatures. Lines 75–83
  retain all nine protected assignment categories and existing placeholder
  semantics; lines 85–102 cover Git-less packages, altered/new references and
  application credentials without mutating installed payloads. These are
  source-review observations, not claims that this reviewer ran those tests.
- `scripts/source-file-inventory-test.js:13` adds the new scanner helper to the
  copied disposable-package fixture so the unchanged scanner boundary tests
  remain executable. `scripts/application-regression-suite.js:63` adds the new
  regression immediately after the real repository secret scan. The source
  inventory implementation is unchanged and continues scanning reference and
  agent files.
- `.ai-team/setup/verify-setup.py:19` rejects missing, symlinked and escaping
  manifest files. Lines 34–43 check immutable bytes and the owned AGENTS block.
  Lines 45–54 check all role names/fields, roster agreement and recipe count.
  Independent comparison established that `installation-manifest.json` contains
  exactly the original selected payload minus `.ai-team/WORK.md`: **822 immutable
  entries, zero byte mismatches**. The only declared mutable file is the required
  work log; it intentionally differs from the supplied empty template.
- `.ai-team/setup/README.md:23` accurately explains the original installer's log
  collision instead of claiming its strict check still passes after log edits.
  The optional plugin-list result at `verify-setup.py:60` explicitly does not
  prove runtime/hook trust. README lines 35–42 and 58–68, and `WORK.md:15`, retain
  the real sign-in/host-selector limitations and distinguish actual manually
  loaded host workers from unverified native automatic registry discovery.

The original P1 example-compatibility finding is addressed by this exact-byte
implementation, pending the coordinator's actual execution results. The P2
mutable-log limitation is documented and covered by a separate immutable-payload
verifier. Standalone CLI reauthentication, native auto-discovery and hook trust
remain activation work, not completed runtime claims.

Before publishing, retain the coordinator's observed results for
`node scripts/ai-team-secret-scan-test.js`, `node scripts/secret-scan.js`,
`node scripts/source-file-inventory-test.js`,
`node scripts/security-source-test.js`, `npm run check`, the relevant full
UTC/Melbourne regression builds, and
`python3 .ai-team/setup/verify-setup.py` (plus `--check-plugin` when available).
No production marker or deployment is needed for this setup task. This reviewer
did not run or assert those coordinator-owned checks, and changed only this
evidence file.
