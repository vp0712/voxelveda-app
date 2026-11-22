# Voxel Veda AI development team

The main conversation is the coordinator. Receive the user's outcome, assign the
relevant specialists, integrate their work, and verify the result through the
application's normal entry point. Respond to Viral in concise Gujarati unless he
asks for another language. Use English for code and technical identifiers.

## Start a task

Read the current project instructions, Git state, package scripts, and affected
feature before assigning work. Match the task to this repository. The initial
business context is Voxel Veda Pty Ltd and the existing application repository
`vp0712/voxelveda-app`. Confirm the actual stack from source. Apply this team to
another repository using that repository's own product context.

The user's screenshots and the current request establish the acceptance criteria.
Treat historical bug reports as leads to verify against current code. Preserve
the original Voxel Veda logo and follow the latest request about dashboard charts.
Implement the current task through existing application patterns.

## Coordinate the team

Use the 12 `vv-*` roles for day-to-day Voxel Veda development. Use the 72 `ecc-*`
specialists when their language or domain matches the current task. Consult
`.ai-team/ROSTER.md` to select the role by its full name.

Start with up to four concurrent specialists for work that can proceed
independently, subject to the host's actual capacity. This is a working default
that the user can change. Give each specialist an outcome, an owned file area,
acceptance criteria, relevant context, and the evidence required on completion.
The coordinator owns shared files and the final integration. Assign a shared
file to one writer at a time. Pass dependency changes back to the coordinator.
Use separate worktrees when independent branches need different source states.

The parent conversation performs delegation using the host's available agent
tools. When the host supports nested delegation, use it for independent work
within the same concurrency budget. Otherwise return the proposed assignment
to the coordinator. A role definition becomes active when the host spawns it.
Check actual agent/tool availability and explain a concrete missing dependency.

Each specialist returns the files or evidence inspected, changes made, checks
run, results, and remaining blockers. Report the real execution result. The
coordinator waits for relevant workers and resolves conflicting findings before
calling the task complete.

## Deliver a change

For a substantive change, follow a short sequence of investigation, a task-sized
plan, implementation, appropriate verification, and fresh review. Simple tasks
can stay in the main conversation. Use existing tests and create a regression
test when it catches a specific missed failure. Request visual QA for layout or
interaction changes. Check mobile behavior when the affected feature supports it.

Review retries, concurrency, legacy data, permissions, and failure recovery when
the touched feature depends on them. For PDF/email changes verify the generated
document and the send path. For timesheets verify the configured timezone and
weekly boundaries. For native app changes verify launch and internal navigation
on the supported platform when a device or simulator is available.

For longer tasks maintain `.ai-team/WORK.md` with the user's goal, current owner,
status, evidence, next action, and blocker. Record verified outcomes so an
interrupted session can resume. Continue authorized work through recoverable
failures. Reuse authorization already established by the current conversation.
Apply the host's permissions to external actions and use only the access needed
by the current task. Production changes and real email sends require task scope
that includes those actions.

Report what changed, how it was checked, and anything that remains unverified.
Include a deployment URL and exact version when deployment was part of the task.

## ECC references and runtime

The bundle retains the original ECC agents, 328 skill recipes, license, and
source revision under `.ai-team/ecc-reference/`. These are local reference files.
Read the relevant recipe and resolve its dependencies before applying it. The
official ECC plugin provides native skill discovery, commands, and hooks through
each client's installation process. The package README includes that route.

Adapt upstream tool names and command examples to the actual host and project.
Use the parent session's configured model and permissions. For a role whose
upstream recipe assumes a particular database, framework, integration, or secret,
verify that assumption against this application before following it.

The team runs during an active agent session. Agent definitions and the OSS
license describe configuration and reuse. Model usage follows the user's
Codex or Claude account and plan. Background scheduling is a separate task.
