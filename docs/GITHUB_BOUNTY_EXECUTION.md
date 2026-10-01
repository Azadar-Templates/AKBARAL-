# GitHub bounty execution worker

The GitHub bounty worker extends the existing discovery → risk screen → repository-policy → exclusive assignment → `MoneyActor`/grant → candidate → owner-hash approval → GitHub submission workflow. It does not create a second bounty system, a payment path, a GitHub identity, or a settlement adapter.

## What it can autonomously do

When all existing policy and grant checks pass, `GithubBountyWorkflow.runExecutionCycle()` can process **one** eligible assignment:

1. reads the open GitHub issue and repository metadata through the existing bounded GitHub client;
2. downloads a bounded source archive as opaque bytes (the mission process never extracts or loads it);
3. asks the dedicated OCI runner to inspect the archive;
4. obtains a strictly parsed one-file proposal through the already owner-configured, metered agent model resource (`mission_resource_calls` and its existing wallet/budget control);
5. passes the exact explicit test argv arrays and archive only to the OCI runner;
6. calls the pre-existing `draft()` method only after the runner reports all tests successful.

The drafted candidate is still `eligible`, has the existing mandatory AI disclosure, and needs the **existing exact content-hash owner approval** before `submit()` can make any GitHub mutation. A test pass is sandbox evidence, not a claim that GitHub checks, a merge, a bounty, or payment happened.

The current GitHub candidate schema commits one file atomically. The proposal validator deliberately requires exactly one file rather than silently dropping generated changes. Multi-file commits need a separately reviewed extension of the existing candidate/submission contract.

## Production sandbox provisioning

The worker fails closed unless both of these are ready:

- an owner-configured, legitimately metered model resource for the assigned agent, including the existing free-tier/billing gate; and
- a locally pre-provisioned, immutable OCI image whose digest is configured in `ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST` (value must be `sha256:<64 lowercase hex>`).

Build the trusted runner image from `sandbox/github-bounty/Dockerfile` in deployment CI, scan/sign it, load it into the runtime's local image store, and configure only its digest. The worker runs `docker|podman image inspect` and `run --pull=never`; it will never build or pull a tag, run an image selected by repository/model input, or fall back to `unshare`/the host shell. Optional `ZA141251SA_BOUNTY_SANDBOX_RUNTIME` is restricted to `docker` or `podman` and defaults to `docker`.

Every invocation is a new `--rm` container with:

- no network (`--network=none`), no Docker socket, no host home, and no mission credential mount or environment forwarding into the container;
- read-only root filesystem, a limited noexec/nosuid/nodev workspace tmpfs, and a separate limited tmpfs for `/tmp`;
- one readonly mount for the public source archive and one readonly mount for the non-secret proposal JSON;
- non-root UID `65532`, all Linux capabilities dropped, and `no-new-privileges`;
- CPU, memory/memory-swap, PID, file-descriptor, command, response, archive, and wall-clock bounds;
- no shell interpolation for generated tests (test input is explicit validated argv only), bounded stdout evidence, and `finally` scratch-directory cleanup.

The archive and proposal mounts are world-readable **inside the scratch mount only** so fixed UID 65532 can read them. They must never contain a credential; no mission secret is passed to the container. They are removed after each run. Docker daemon isolation is a deployment prerequisite: do not enable this worker on a host where access to the Docker daemon itself grants untrusted users broader host control.

The runner pre-lists archive paths, rejects traversal-shaped paths, unpacks only into its tmpfs, rejects symlink parents/targets for the proposed write, and executes tests only within that container. The mission Node process does not call an archive extractor, `npm`, test script, package manager, or repository executable.

## States and honest boundaries

`mission_bounty_execution_jobs` records `queued → inspecting → generating → verifying → verified → drafted`, or terminal `blocked`/`failed` evidence. It stores bounded issue/inspection/proposal/test evidence and an archive hash, **not archive bytes**. Uncertain provider/sandbox/GitHub steps block rather than replay automatically.

A blocked GitHub submission means the owner must supply a legitimate GitHub identity/token that can fork the upstream project, write Contents to the owner's fork, and open a pull request against the upstream project. The worker does not bypass CAPTCHA, KYC, repository rules, or GitHub permissions. After actual submission, the existing passive PR review/check/merge monitor remains authoritative. A GitHub merge is not a receipt; external payout verification is still required before money is recorded as revenue.
