# Installed Codex team

The current repository contains the attachment's unmodified 84 Codex role definitions,
72 upstream ECC agent references and 328 upstream skill recipes. `AGENTS.md` links the
coordinator to `TEAM.md` and `ROSTER.md`; each role inherits its parent model and access.
Only Codex was selected. Existing application instructions and runtime files are retained.

The initial installation used the supplied `install-team.py --project
/workspace/voxelveda-app --client codex --with-ecc`, after its dry run. The original
installer's `--check` passed with zero files to write before populating `WORK.md`.
Package, installer and source provenance, and every immutable installed file hash,
are recorded in `installation-manifest.json`.

## Current verification

From the repository root, with Python 3.11 or newer:

```sh
python3 .ai-team/setup/verify-setup.py
python3 .ai-team/setup/verify-setup.py --check-plugin
```

The original installer treats its empty `WORK.md` template as immutable. Its strict
check or reinstallation reports a collision once this required task log is updated.
Preserve the actual log. The verifier above checks all 822 immutable payload files,
the owned instruction block, the 84 role names/fields and the 328 recipes, while
allowing only `WORK.md` to carry changing task state. It does not assert native agent
execution, sign-in, hook trust or application test results.

The repository's `AI team setup integrity` workflow runs these portable checks
without requiring a personal Codex account. The existing secret scanner continues
covering the whole source inventory. Exactly 13 reviewed public example findings
in 8 bundled files are pinned by complete raw-file SHA-256, path, line and finding
kind; changed bytes or application/new files receive no exemption. The added
scanner regression exercises those boundaries and the original credential classes.

## Native client activation

The available Codex 0.172.0-alpha.2 client installed `ecc@ecc` 2.2.3 through the official
marketplace commands. Local `codex plugin list` confirms installed and enabled.
No previous ECC native or manual/sync installation was found in this checkout or
the inspected client directories. The current managed CLI's execution attempt failed
token refresh with a sign-in-again error; its remote plugin catalog also returned
`451 no_biscuit_no_service`. The local plugin installation itself succeeded.

Restore the CLI's account through its normal secure `codex login` flow; never put
credentials in a repository or chat. Open a fresh Codex session in this repository,
complete any native project/hook trust prompt normally, and run the discovery request
below. No trust or sandbox bypass was used or should be required.

For another Codex installation without ECC, use its official native route:

```sh
codex plugin marketplace add affaan-m/ECC
codex plugin add ecc@ecc
codex plugin list
```

Keep an existing native ECC installation. Review ECC's migration instructions before
combining this with any older full manual/sync installation. References in
`.ai-team/ecc-reference` are documentation, not proof of native skill/hook activation.

## Discovery request after sign-in

Read `.ai-team/TEAM.md` and `.ai-team/ROSTER.md`. Spawn the discovered `vv-planner`
and `vv-reviewer` roles in parallel to inspect application entry points and existing
verification scripts, without file or provider changes. Inherit the parent's model,
wait for both, and report actual role/worker names and file references. If the host
cannot select registered custom roles, report that limitation instead of substituting
generic workers and claiming automatic discovery.

During this setup the current conversation's available native collaboration tools
really ran `/root/vv_planner` and `/root/vv_reviewer`, explicitly loading their installed
role files. Their independent reports are in `../evidence/`. This is useful host
execution evidence, distinct from the still-unverified standalone CLI registry path.
