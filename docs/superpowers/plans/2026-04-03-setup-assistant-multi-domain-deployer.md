# Setup Assistant Multi-Domain Deployer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, Docker-runnable Setup Assistant that deploys the current `cloudflare_temp_email` repo to one Cloudflare account with multiple wildcard root domains, shared destination email, automated Worker/Pages/D1 provisioning, automated Email Routing setup, and explicit manual finish steps.

**Architecture:** Add a new top-level `installer/` Node + Vue package that owns the local web UI, file-backed state, Cloudflare API adapter, and Wrangler-based deploy orchestration. Keep the repo itself as the deploy target by generating per-task runtime configs and artifacts under the installer data directory, then polling task state from the UI instead of introducing websockets or a generalized job platform.

**Tech Stack:** Vue 3 + Vite + Naive UI, Hono on Node.js, TypeScript, Vitest + jsdom, file-backed JSON state, Wrangler CLI, Docker.

---

## File Structure / Responsibility Map

### Create
- `installer/package.json` — installer dependency manifest and scripts.
- `installer/pnpm-lock.yaml` — installer dependency lockfile.
- `installer/tsconfig.json` — shared TypeScript config for server and client.
- `installer/vite.config.ts` — Vite build config for the installer UI.
- `installer/vitest.config.ts` — Vitest config for installer unit/component tests.
- `installer/Dockerfile` — container image for the local installer.
- `installer/.env.example` — local runtime defaults for installer port/data paths.
- `installer/README.md` — focused run/deploy notes for the installer.
- `installer/src/shared/types.ts` — shared request/response/task/domain types.
- `installer/src/server/index.ts` — Node entrypoint.
- `installer/src/server/app.ts` — Hono app wiring and static asset serving.
- `installer/src/server/config.ts` — runtime config/env loading.
- `installer/src/server/defaults.ts` — derived install defaults (project slug, admin password, JWT secret, frontend/api hostnames).
- `installer/src/server/storage/file_store.ts` — file-backed JSON helpers for token/config/task state.
- `installer/src/server/storage/path_layout.ts` — installer data/artifact path resolution.
- `installer/src/server/services/repo_runtime.ts` — resolve current repo root and prepare per-task artifact workspace.
- `installer/src/server/services/command_runner.ts` — typed shell execution wrapper for Wrangler/build commands.
- `installer/src/server/services/cloudflare_api.ts` — token validation, account/zone listing, per-domain mail checks, Email Routing APIs.
- `installer/src/server/services/wrangler_deployer.ts` — D1 create/init, Worker deploy, Pages build/deploy, custom-domain binding.
- `installer/src/server/services/setup_orchestrator.ts` — checkpointed task runner for the full install flow.
- `installer/src/server/routes/health.ts` — simple health endpoint.
- `installer/src/server/routes/setup.ts` — token validation, defaults preview, domain checks, confirm/start endpoints.
- `installer/src/server/routes/tasks.ts` — task polling/result endpoints.
- `installer/src/server/__tests__/defaults.test.ts` — safe-default derivation tests.
- `installer/src/server/__tests__/file_store.test.ts` — local persistence tests.
- `installer/src/server/__tests__/cloudflare_api.test.ts` — mocked Cloudflare API adapter tests.
- `installer/src/server/__tests__/setup_orchestrator.test.ts` — task-state/checkpoint/multi-domain flow tests.
- `installer/src/server/__tests__/app.integration.test.ts` — route-level integration tests with mocked services.
- `installer/src/client/main.ts` — installer frontend bootstrap.
- `installer/src/client/App.vue` — app shell.
- `installer/src/client/api.ts` — browser API client.
- `installer/src/client/store/useSetupStore.ts` — wizard state and polling.
- `installer/src/client/styles.css` — setup-assistant visual tokens and layout.
- `installer/src/client/components/WizardShell.vue` — shared progress layout / navigation.
- `installer/src/client/components/steps/WelcomeStep.vue` — step 1.
- `installer/src/client/components/steps/TokenStep.vue` — step 2.
- `installer/src/client/components/steps/DomainSelectionStep.vue` — step 3.
- `installer/src/client/components/steps/DeployTargetsStep.vue` — step 4.
- `installer/src/client/components/steps/DomainChecksStep.vue` — step 5.
- `installer/src/client/components/steps/ConfirmChangesStep.vue` — step 6.
- `installer/src/client/components/steps/DeployProgressStep.vue` — step 7.
- `installer/src/client/components/steps/ManualFinishStep.vue` — step 8.
- `installer/src/client/components/domain/DomainStatusCard.vue` — per-domain check/result card.
- `installer/src/client/components/domain/MxConflictList.vue` — destructive MX confirmation widget.
- `installer/src/client/components/__tests__/wizard_shell.test.ts` — shell/progress rendering tests.
- `installer/src/client/components/__tests__/domain_checks_step.test.ts` — MX warning/confirmation UI tests.
- `installer/src/client/components/__tests__/manual_finish_step.test.ts` — final checklist UI tests.
- `docker-compose.installer.yml` — local container entrypoint for the installer app.

### Modify
- `.dockerignore` — keep installer build context lean if needed.
- `README.md` — add short section linking to the installer flow.
- `README_EN.md` — add matching installer section.
- `docs/superpowers/specs/2026-04-03-setup-assistant-multi-domain-deployer-design.md` — only if spec-follow-up clarifications are needed during implementation.

---

### Task 1: Scaffold the Installer Package and Baseline Tooling

**Files:**
- Create: `installer/package.json`
- Create: `installer/tsconfig.json`
- Create: `installer/vite.config.ts`
- Create: `installer/vitest.config.ts`
- Create: `installer/src/server/index.ts`
- Create: `installer/src/server/app.ts`
- Create: `installer/src/client/main.ts`
- Create: `installer/src/client/App.vue`
- Create: `installer/src/client/styles.css`
- Test: `installer/src/client/components/__tests__/wizard_shell.test.ts`

- [ ] **Step 1: Write the failing app-shell test**

```ts
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import App from '../../App.vue';

describe('installer app shell', () => {
  it('renders the setup assistant title', () => {
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('Setup Assistant');
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:
```bash
pnpm --dir installer install
pnpm --dir installer vitest run installer/src/client/components/__tests__/wizard_shell.test.ts
```
Expected: FAIL because `App.vue` and Vitest/Vue wiring do not exist yet.

- [ ] **Step 3: Write the minimal installer shell implementation**

```ts
// installer/src/client/main.ts
import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

createApp(App).mount('#app');
```

```vue
<!-- installer/src/client/App.vue -->
<template>
  <main class="app-shell">
    <h1>Setup Assistant</h1>
    <p>Cloudflare Temp Email installer</p>
  </main>
</template>
```

- [ ] **Step 4: Run installer tests/build to verify GREEN**

Run:
```bash
pnpm --dir installer test
pnpm --dir installer build
```
Expected: PASS and Vite build exits 0.

- [ ] **Step 5: Commit**

```bash
git add installer/package.json installer/pnpm-lock.yaml installer/tsconfig.json installer/vite.config.ts installer/vitest.config.ts installer/src/client/main.ts installer/src/client/App.vue installer/src/client/styles.css installer/src/client/components/__tests__/wizard_shell.test.ts

git commit -m "feat(installer): scaffold local setup assistant"
```

### Task 2: Add Shared Types, Safe Defaults, and File-Backed Persistence

**Files:**
- Create: `installer/src/shared/types.ts`
- Create: `installer/src/server/config.ts`
- Create: `installer/src/server/defaults.ts`
- Create: `installer/src/server/storage/file_store.ts`
- Create: `installer/src/server/storage/path_layout.ts`
- Create: `installer/src/server/__tests__/defaults.test.ts`
- Create: `installer/src/server/__tests__/file_store.test.ts`

- [ ] **Step 1: Write failing tests for install defaults and JSON persistence**

```ts
import { describe, expect, it } from 'vitest';
import { buildInstallDefaults } from '../defaults';

describe('buildInstallDefaults', () => {
  it('derives wildcard rules, control domains, and secrets from root domains', () => {
    const result = buildInstallDefaults({
      rootDomains: ['alpha.com', 'beta.net'],
      primaryControlDomain: 'alpha.com',
      destinationAddress: 'ops@example.net',
    });

    expect(result.wildcardRules).toEqual(['*.alpha.com', '*.beta.net']);
    expect(result.frontendDomain).toBe('mail.alpha.com');
    expect(result.apiDomain).toBe('email-api.alpha.com');
    expect(result.adminPassword.length).toBeGreaterThanOrEqual(16);
    expect(result.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run:
```bash
pnpm --dir installer vitest run installer/src/server/__tests__/defaults.test.ts installer/src/server/__tests__/file_store.test.ts
```
Expected: FAIL because the defaults and file-store modules do not exist.

- [ ] **Step 3: Write the minimal shared models and persistence layer**

```ts
export interface InstallDraft {
  accountId: string;
  accountName: string;
  rootDomains: string[];
  primaryControlDomain: string;
  destinationAddress: string;
  projectSlug: string;
  frontendSubdomain: string;
  apiSubdomain: string;
}
```

```ts
import crypto from 'node:crypto';

export const buildInstallDefaults = ({ rootDomains, primaryControlDomain, destinationAddress }: {
  rootDomains: string[];
  primaryControlDomain: string;
  destinationAddress: string;
}) => ({
  destinationAddress,
  wildcardRules: rootDomains.map((domain) => `*.${domain}`),
  projectSlug: `tempmail-${primaryControlDomain.replace(/\./g, '-')}`,
  frontendSubdomain: 'mail',
  apiSubdomain: 'email-api',
  frontendDomain: `mail.${primaryControlDomain}`,
  apiDomain: `email-api.${primaryControlDomain}`,
  adminPassword: crypto.randomBytes(12).toString('base64url'),
  jwtSecret: crypto.randomBytes(24).toString('base64url'),
});
```

- [ ] **Step 4: Re-run the tests to verify GREEN**

Run:
```bash
pnpm --dir installer test -- defaults
pnpm --dir installer test -- file_store
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add installer/src/shared/types.ts installer/src/server/config.ts installer/src/server/defaults.ts installer/src/server/storage/file_store.ts installer/src/server/storage/path_layout.ts installer/src/server/__tests__/defaults.test.ts installer/src/server/__tests__/file_store.test.ts

git commit -m "feat(installer): add local state and install defaults"
```

### Task 3: Implement the Cloudflare API Adapter for Token, Accounts, Zones, and Email Routing Checks

**Files:**
- Create: `installer/src/server/services/cloudflare_api.ts`
- Create: `installer/src/server/__tests__/cloudflare_api.test.ts`
- Modify: `installer/src/shared/types.ts`

- [ ] **Step 1: Write failing adapter tests for token validation and per-domain mail checks**

```ts
import { describe, expect, it, vi } from 'vitest';
import { CloudflareApi } from '../services/cloudflare_api';

describe('CloudflareApi', () => {
  it('returns grouped accounts and zones for a valid token', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [{ id: 'acct_1', name: 'Team A' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: [{ id: 'zone_1', name: 'alpha.com', account: { id: 'acct_1' } }] })));

    const api = new CloudflareApi({ token: 'cf_token', fetch: fetcher as any });
    const result = await api.validateAndListTargets();

    expect(result.accounts[0].id).toBe('acct_1');
    expect(result.accounts[0].zones[0].name).toBe('alpha.com');
  });

  it('marks MX conflicts when a selected root domain already has MX records', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: [{ id: 'record_1', type: 'MX', name: 'alpha.com', content: 'mx.old.net', priority: 10 }] })),
    );

    const api = new CloudflareApi({ token: 'cf_token', fetch: fetcher as any });
    const result = await api.inspectRootDomain({ zoneId: 'zone_1', domain: 'alpha.com' });

    expect(result.hasMxConflict).toBe(true);
    expect(result.mxRecords).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the adapter test to verify RED**

Run:
```bash
pnpm --dir installer vitest run installer/src/server/__tests__/cloudflare_api.test.ts
```
Expected: FAIL with missing adapter module/export errors.

- [ ] **Step 3: Write the minimal adapter implementation**

```ts
export class CloudflareApi {
  constructor(private readonly deps: { token: string; fetch: typeof fetch }) {}

  async validateAndListTargets() {
    // call account list, zone list, and return accounts grouped with zones
  }

  async inspectRootDomain(input: { zoneId: string; domain: string }) {
    // call DNS/MX and Email Routing status endpoints, return normalized check result
  }
}
```

Implementation notes:
- Keep all HTTP logic in this file.
- Normalize Cloudflare API failures into one installer-friendly error shape.
- Return `missingPermissions[]` when capability probes fail.
- Expose explicit methods for: listing accounts/zones, inspecting one root domain, deleting confirmed MX records, ensuring a destination address, enabling Email Routing DNS, and configuring catch-all/worker routing.

- [ ] **Step 4: Re-run the adapter test to verify GREEN**

Run:
```bash
pnpm --dir installer test -- cloudflare_api
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add installer/src/server/services/cloudflare_api.ts installer/src/server/__tests__/cloudflare_api.test.ts installer/src/shared/types.ts

git commit -m "feat(installer): add cloudflare api adapter"
```

### Task 4: Add Repo Runtime Prep and Wrangler Command Execution

**Files:**
- Create: `installer/src/server/services/repo_runtime.ts`
- Create: `installer/src/server/services/command_runner.ts`
- Create: `installer/src/server/services/wrangler_deployer.ts`
- Modify: `installer/src/server/config.ts`
- Test: `installer/src/server/__tests__/setup_orchestrator.test.ts`

- [ ] **Step 1: Add a failing test for generated runtime configs and command sequencing**

```ts
it('writes per-task worker config and deploy commands using the current repo as the source root', async () => {
  // assert generated config path under data/artifacts/<task-id>/
  // assert worker deploy, d1 init, and pages deploy commands are enqueued in order
});
```

- [ ] **Step 2: Run the orchestrator test to verify RED**

Run:
```bash
pnpm --dir installer vitest run installer/src/server/__tests__/setup_orchestrator.test.ts
```
Expected: FAIL because runtime/deployer services do not exist yet.

- [ ] **Step 3: Write the minimal runtime prep and Wrangler wrapper**

Implementation notes:
- `repo_runtime.ts` should resolve the repo root relative to `installer/` and create `data/artifacts/<task-id>/configs`.
- `wrangler_deployer.ts` should:
  - generate `worker.wrangler.toml` from `worker/wrangler.toml.template`
  - inject derived install values into the generated worker config, including `DOMAINS`, `DEFAULT_DOMAINS`, `JWT_SECRET`, `ADMIN_PASSWORDS`, `FRONTEND_URL`, and the selected custom domains
  - generate `pages` deploy arguments from the selected `primaryControlDomain`
  - run D1 create/init and Worker/Pages deploy via `command_runner.ts`
- Keep command construction pure/testable where possible.

- [ ] **Step 4: Re-run orchestrator-related tests to verify GREEN**

Run:
```bash
pnpm --dir installer test -- setup_orchestrator
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add installer/src/server/services/repo_runtime.ts installer/src/server/services/command_runner.ts installer/src/server/services/wrangler_deployer.ts installer/src/server/config.ts installer/src/server/__tests__/setup_orchestrator.test.ts

git commit -m "feat(installer): add runtime workspace and wrangler deployer"
```

### Task 5: Implement the Checkpointed Setup Orchestrator

**Files:**
- Create: `installer/src/server/services/setup_orchestrator.ts`
- Modify: `installer/src/shared/types.ts`
- Modify: `installer/src/server/storage/file_store.ts`
- Modify: `installer/src/server/__tests__/setup_orchestrator.test.ts`

- [ ] **Step 1: Write failing tests for task state transitions, per-domain statuses, and blockers**

```ts
it('moves a task into blocked_by_confirmation when MX deletion is required', async () => {
  // seed draft with rootDomains ['alpha.com'] and mocked inspectRootDomain returning hasMxConflict=true
  // expect task.status === 'blocked_by_confirmation'
  // expect blocker.type === 'mx_delete_confirmation'
});

it('records success_with_manual_steps when destination verification remains pending', async () => {
  // mocked deploy + routing success, destination status pending verification
  // expect final status / summary reflects manual finish required
});
```

- [ ] **Step 2: Run the orchestrator test to verify RED**

Run:
```bash
pnpm --dir installer test -- setup_orchestrator
```
Expected: FAIL with missing state-machine behavior.

- [ ] **Step 3: Write the minimal orchestrator implementation**

Required checkpoints:
- `validate_token`
- `inspect_domains`
- `confirm_changes`
- `prepare_infrastructure`
- `deploy_worker`
- `deploy_pages`
- `configure_email_routing`
- `finalize`

Required terminal statuses:
- `success`
- `success_with_manual_steps`
- `partial_success`
- `failed`
- `blocked_by_confirmation`
- `blocked_by_manual`

Required orchestration behavior:
- create and/or reuse the shared destination address
- enable Email Routing DNS for each selected root domain
- configure catch-all -> Worker for each selected root domain
- after Worker deploy, call the deployed `/admin/cloudflare_wildcard_settings` endpoint (using the generated admin password) to persist the wildcard pool into DB-backed settings; if this sync fails while env bootstrap still succeeds, surface it as a warning/manual follow-up instead of silently dropping it

- [ ] **Step 4: Re-run the orchestrator tests to verify GREEN**

Run:
```bash
pnpm --dir installer test -- setup_orchestrator
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add installer/src/server/services/setup_orchestrator.ts installer/src/shared/types.ts installer/src/server/storage/file_store.ts installer/src/server/__tests__/setup_orchestrator.test.ts

git commit -m "feat(installer): add checkpointed setup orchestration"
```

### Task 6: Expose Installer API Routes

**Files:**
- Create: `installer/src/server/routes/health.ts`
- Create: `installer/src/server/routes/setup.ts`
- Create: `installer/src/server/routes/tasks.ts`
- Create: `installer/src/server/__tests__/app.integration.test.ts`
- Modify: `installer/src/server/app.ts`
- Modify: `installer/src/server/index.ts`

- [ ] **Step 1: Write failing route tests for token validation, draft preview, and task polling**

```ts
it('POST /api/setup/validate-token returns accounts and zones', async () => {
  // inject mocked CloudflareApi
});

it('POST /api/setup/inspect returns grouped domain checks and change preview', async () => {
  // inject mocked defaults + CloudflareApi
});

it('GET /api/tasks/:id returns persisted task state', async () => {
  // seed file store and verify route response
});
```

- [ ] **Step 2: Run the route tests to verify RED**

Run:
```bash
pnpm --dir installer vitest run installer/src/server/__tests__/app.integration.test.ts
```
Expected: FAIL because routes are not implemented.

- [ ] **Step 3: Write the minimal Hono routes**

Required endpoints:
- `GET /api/health`
- `POST /api/setup/validate-token`
- `POST /api/setup/inspect`
- `POST /api/setup/confirm-and-start`
- `POST /api/setup/tasks/:id/confirm-mx-deletions`
- `GET /api/tasks/:id`

Implementation notes:
- Keep payload validation at the route boundary.
- Persist the latest validated token and draft before task launch.
- Do not add websockets or SSE; polling is enough.

- [ ] **Step 4: Re-run the route tests to verify GREEN**

Run:
```bash
pnpm --dir installer test -- app.integration
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add installer/src/server/routes/health.ts installer/src/server/routes/setup.ts installer/src/server/routes/tasks.ts installer/src/server/app.ts installer/src/server/index.ts installer/src/server/__tests__/app.integration.test.ts

git commit -m "feat(installer): add setup assistant api routes"
```

### Task 7: Build the Wizard Shell and Welcome / Token Steps

**Files:**
- Create: `installer/src/client/api.ts`
- Create: `installer/src/client/store/useSetupStore.ts`
- Create: `installer/src/client/components/WizardShell.vue`
- Create: `installer/src/client/components/steps/WelcomeStep.vue`
- Create: `installer/src/client/components/steps/TokenStep.vue`
- Modify: `installer/src/client/App.vue`
- Modify: `installer/src/client/components/__tests__/wizard_shell.test.ts`

- [ ] **Step 1: Extend the shell test with failing progress/step rendering assertions**

```ts
it('shows step 1 and step 2 labels in the wizard shell', () => {
  const wrapper = mount(App);
  expect(wrapper.text()).toContain('Welcome');
  expect(wrapper.text()).toContain('Cloudflare Token');
});
```

- [ ] **Step 2: Run the shell test to verify RED**

Run:
```bash
pnpm --dir installer test -- wizard_shell
```
Expected: FAIL because the shell/steps are not wired.

- [ ] **Step 3: Write the minimal setup-assistant shell and token-validation flow**

Implementation notes:
- `WizardShell.vue` should render the left-side step list and the current step panel.
- `TokenStep.vue` should call `POST /api/setup/validate-token` and write the result into the store.
- Keep the visual style calm/minimal; one primary action per screen.

- [ ] **Step 4: Re-run the shell tests to verify GREEN**

Run:
```bash
pnpm --dir installer test -- wizard_shell
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add installer/src/client/api.ts installer/src/client/store/useSetupStore.ts installer/src/client/components/WizardShell.vue installer/src/client/components/steps/WelcomeStep.vue installer/src/client/components/steps/TokenStep.vue installer/src/client/App.vue installer/src/client/components/__tests__/wizard_shell.test.ts

git commit -m "feat(installer): add wizard shell and token step"
```

### Task 8: Implement Account / Root Domain Selection and Deploy Target Preview

**Files:**
- Create: `installer/src/client/components/steps/DomainSelectionStep.vue`
- Create: `installer/src/client/components/steps/DeployTargetsStep.vue`
- Modify: `installer/src/client/store/useSetupStore.ts`
- Modify: `installer/src/client/api.ts`

- [ ] **Step 1: Write a failing client test for selecting multiple domains and a primary control domain**

```ts
it('requires a primary control domain from the selected root domains', async () => {
  // mount DomainSelectionStep with selected domains ['alpha.com', 'beta.net']
  // expect next action disabled until primaryControlDomain is one of them
});
```

- [ ] **Step 2: Run the domain-selection test to verify RED**

Run:
```bash
pnpm --dir installer test -- DomainSelectionStep
```
Expected: FAIL because the step component does not exist.

- [ ] **Step 3: Write the minimal selection and preview steps**

Required behavior:
- group zones under the selected account
- allow multi-select root domains
- require one `primaryControlDomain`
- preview wildcard rules, frontend domain, and API domain before moving on
- allow edit/override for `projectSlug`, `frontendSubdomain`, and `apiSubdomain`

- [ ] **Step 4: Re-run the selection/preview tests to verify GREEN**

Run:
```bash
pnpm --dir installer test -- DomainSelectionStep
pnpm --dir installer test -- wizard_shell
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add installer/src/client/components/steps/DomainSelectionStep.vue installer/src/client/components/steps/DeployTargetsStep.vue installer/src/client/store/useSetupStore.ts installer/src/client/api.ts

git commit -m "feat(installer): add domain selection and target preview"
```

### Task 9: Implement Domain Checks, MX Warnings, and Confirm Changes

**Files:**
- Create: `installer/src/client/components/domain/DomainStatusCard.vue`
- Create: `installer/src/client/components/domain/MxConflictList.vue`
- Create: `installer/src/client/components/steps/DomainChecksStep.vue`
- Create: `installer/src/client/components/steps/ConfirmChangesStep.vue`
- Create: `installer/src/client/components/__tests__/domain_checks_step.test.ts`
- Modify: `installer/src/client/store/useSetupStore.ts`

- [ ] **Step 1: Write failing UI tests for MX warnings and destructive confirmation**

```ts
it('shows delete confirmation when a root domain has conflicting MX records', async () => {
  // render DomainChecksStep with domainChecks containing hasMxConflict=true
  // expect warning copy and listed MX records
});

it('does not enable continue until destructive confirmations are acknowledged', async () => {
  // render ConfirmChangesStep with pending destructive changes
  // expect continue button disabled until checkbox is checked
});
```

- [ ] **Step 2: Run the domain-check tests to verify RED**

Run:
```bash
pnpm --dir installer test -- domain_checks_step
```
Expected: FAIL because the UI components do not exist.

- [ ] **Step 3: Write the minimal domain-status and confirmation UI**

Required behavior:
- render each root domain as its own status card
- list MX records, DNS status, routing status, and destination state
- separate warnings from blockers visually
- in the confirmation step, summarize creates / updates / deletes before task launch

- [ ] **Step 4: Re-run the domain-check tests to verify GREEN**

Run:
```bash
pnpm --dir installer test -- domain_checks_step
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add installer/src/client/components/domain/DomainStatusCard.vue installer/src/client/components/domain/MxConflictList.vue installer/src/client/components/steps/DomainChecksStep.vue installer/src/client/components/steps/ConfirmChangesStep.vue installer/src/client/components/__tests__/domain_checks_step.test.ts installer/src/client/store/useSetupStore.ts

git commit -m "feat(installer): add domain checks and change confirmation"
```

### Task 10: Implement Deploy Progress Polling and Manual Finish Checklist

**Files:**
- Create: `installer/src/client/components/steps/DeployProgressStep.vue`
- Create: `installer/src/client/components/steps/ManualFinishStep.vue`
- Create: `installer/src/client/components/__tests__/manual_finish_step.test.ts`
- Modify: `installer/src/client/store/useSetupStore.ts`
- Modify: `installer/src/client/App.vue`

- [ ] **Step 1: Write failing UI tests for progress polling and the final checklist**

```ts
it('renders per-domain progress rows while a task is running', async () => {
  // mock task polling state with domains alpha.com/beta.net
  // expect progress list to include both
});

it('renders manual destination verification and test-mail steps for success_with_manual_steps', () => {
  // mount ManualFinishStep with final summary
  // expect checklist copy and generated URLs
});
```

- [ ] **Step 2: Run the final-step tests to verify RED**

Run:
```bash
pnpm --dir installer test -- manual_finish_step
```
Expected: FAIL because the progress/final components are not present.

- [ ] **Step 3: Write the minimal progress polling and finish-summary UI**

Required behavior:
- poll `GET /api/tasks/:id` while status is `running`, `blocked_by_confirmation`, or `blocked_by_manual`
- show step-level progress plus per-domain states
- render final URLs, wildcard rules, destination address, and manual finish checklist
- distinguish `success`, `success_with_manual_steps`, and `partial_success`

- [ ] **Step 4: Re-run the final-step tests to verify GREEN**

Run:
```bash
pnpm --dir installer test -- manual_finish_step
pnpm --dir installer test -- wizard_shell
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add installer/src/client/components/steps/DeployProgressStep.vue installer/src/client/components/steps/ManualFinishStep.vue installer/src/client/components/__tests__/manual_finish_step.test.ts installer/src/client/store/useSetupStore.ts installer/src/client/App.vue

git commit -m "feat(installer): add deploy progress and finish checklist"
```

### Task 11: Dockerize the Installer and Document the Local Run Flow

**Files:**
- Create: `installer/Dockerfile`
- Create: `installer/.env.example`
- Create: `installer/README.md`
- Create: `docker-compose.installer.yml`
- Modify: `.dockerignore`
- Modify: `README.md`
- Modify: `README_EN.md`

- [ ] **Step 1: Write the Docker contract and confirm it currently fails**

Document the expected command first in `installer/README.md`:

```md
docker compose -f docker-compose.installer.yml up --build
```

Then verify the command currently fails because the compose file and Dockerfile do not exist.

Run:
```bash
docker compose -f docker-compose.installer.yml config
```
Expected: FAIL with missing compose file.

- [ ] **Step 2: Write the minimal Docker assets and docs**

Implementation notes:
- Docker image should install installer dependencies and expose one local port.
- Mount a local data volume for token/config/log persistence.
- Mount the repo read/write so Wrangler can build/deploy the current repo.
- Document that destination verification and test mail remain manual.

- [ ] **Step 3: Verify the Docker contract and installer build**

Run:
```bash
docker compose -f docker-compose.installer.yml config
pnpm --dir installer build
```
Expected: both commands exit 0.

- [ ] **Step 4: Run the full installer test suite**

Run:
```bash
pnpm --dir installer test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add installer/Dockerfile installer/.env.example installer/README.md docker-compose.installer.yml .dockerignore README.md README_EN.md

git commit -m "build(installer): add dockerized local deployment tool"
```

### Task 12: Final Verification and Handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-04-03-setup-assistant-multi-domain-deployer-design.md` (only if implementation forced approved spec clarifications)

- [ ] **Step 1: Run the complete installer + existing repo verification set**

Run:
```bash
pnpm --dir installer test
pnpm --dir installer build
pnpm --dir worker test
pnpm --dir frontend test
```
Expected: all commands exit 0.

- [ ] **Step 2: Do a manual dry-run sanity check in the installer UI**

Run:
```bash
pnpm --dir installer dev
```
Then manually verify:
- wizard opens on Welcome
- token validation step blocks/advances correctly
- multi-domain selection requires a primary control domain
- MX conflict flow visibly blocks continuation
- final page shows manual verification + test-mail checklist

- [ ] **Step 3: Update docs if implementation revealed a necessary spec clarification**

Only if needed; avoid gratuitous spec churn.

- [ ] **Step 4: Commit final verification/doc touch-ups**

```bash
git add docs/superpowers/specs/2026-04-03-setup-assistant-multi-domain-deployer-design.md

git commit -m "docs(installer): align deployer spec after implementation"
```

Skip this commit if no spec/doc changes were required.
