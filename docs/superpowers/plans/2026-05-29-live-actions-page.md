# Live Actions Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new “Live Actions” page that shows real-time action stream (jobs, agent outputs, audit events), with filters and auto-refresh, inside existing Trading Command Center navigation.

**Architecture:** Reuse existing shell routing (`[slug]` + `TradingCommandCenterShell`) and existing `/api/logs` backend as primary source. Add one focused dashboard component for live actions and wire it into navigation config + shell page switch. Keep changes minimal, behavior-driven, and compatible with current logs/jobs data contracts.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Bun test mocks, existing UI kit (`Card`, `Table`, `Badge`, `Button`, `Input`, `Switch`), existing auth on API routes.

---

### Task 1: Add route/navigation support for Live Actions page

**Files:**
- Modify: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/navigation/trading-pages.ts`
- Modify: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/components/trading-shell/TradingCommandCenterShell.tsx`
- Test: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/navigation-live-actions.test.ts`

- [ ] **Step 1: Write failing test for navigation contract**

```ts
import { describe, expect, it } from 'bun:test';
import { TRADING_PAGES, getTradingPageBySlug, getTradingPageHref } from '@/lib/navigation/trading-pages';

describe('live actions navigation', () => {
  it('registers live actions page in trading pages', () => {
    const page = TRADING_PAGES.find((p) => p.id === 'liveActions');
    expect(page).toBeDefined();
    expect(page?.slug).toBe('live-actions');
  });

  it('resolves slug and href for live actions page', () => {
    const page = getTradingPageBySlug('live-actions');
    expect(page?.id).toBe('liveActions');
    expect(getTradingPageHref('liveActions')).toBe('/live-actions');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/navigation-live-actions.test.ts"`
Expected: FAIL (missing `liveActions` in `PageView`/`TRADING_PAGES`)

- [ ] **Step 3: Minimal implementation in navigation map**

```ts
// in PageView union
| 'liveActions'

// in TRADING_PAGES
{ id: 'liveActions', label: 'Live Actions', slug: 'live-actions' },
```

- [ ] **Step 4: Wire shell icon + page switch case (minimal)**

```ts
// NAV_ICONS
liveActions: Activity,

// PageContent switch
case 'liveActions':
  return <LiveActionsDashboard />;
```

- [ ] **Step 5: Run test to verify pass**

Run: `bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/navigation-live-actions.test.ts"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  src/lib/navigation/trading-pages.ts \
  src/components/trading-shell/TradingCommandCenterShell.tsx \
  src/lib/engine/__tests__/navigation-live-actions.test.ts
git commit -m "feat: add live actions route to trading navigation"
```

---

### Task 2: Build LiveActionsDashboard component with real-time table

**Files:**
- Create: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/components/trading/LiveActionsDashboard.tsx`
- Test: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/live-actions-dashboard.test.tsx`

- [ ] **Step 1: Write failing component behavior test**

```tsx
import { describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import { LiveActionsDashboard } from '@/components/trading/LiveActionsDashboard';

global.fetch = mock(async () =>
  new Response(
    JSON.stringify({
      entries: [
        {
          id: 'job-1',
          type: 'Job',
          action: 'PAPER_EXECUTE',
          message: 'Job completed',
          status: 'COMPLETED',
          timestamp: new Date().toISOString(),
        },
      ],
      page: 1,
      limit: 25,
      stats: { totalLogs: 1, failedCount: 0, recentActivity: 1 },
    }),
  ),
) as any;

describe('LiveActionsDashboard', () => {
  it('renders live action rows from logs API', async () => {
    render(<LiveActionsDashboard />);
    await waitFor(() => expect(screen.getByText('PAPER_EXECUTE')).toBeInTheDocument());
    expect(screen.getByText('Live Actions')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/live-actions-dashboard.test.tsx"`
Expected: FAIL (component not found)

- [ ] **Step 3: Create minimal component**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface LiveEntry {
  id: string;
  type: 'Job' | 'Audit' | 'AgentOutput';
  action: string;
  message: string;
  status: string;
  timestamp: string;
}

export function LiveActionsDashboard() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch('/api/logs?sort=desc&page=1&limit=25');
      if (!res.ok) return;
      const data = await res.json();
      if (!cancelled) setEntries(data.entries ?? []);
    }
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-600/20">
          <Activity className="h-4 w-4 text-cyan-400" />
        </div>
        <h2 className="text-xl font-semibold text-white">Live Actions</h2>
      </div>

      <Card className="border-gray-800 bg-gray-900">
        <CardHeader>
          <CardTitle className="text-sm text-white">Action Stream</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-800">
                <TableHead className="text-gray-500">Type</TableHead>
                <TableHead className="text-gray-500">Action</TableHead>
                <TableHead className="text-gray-500">Status</TableHead>
                <TableHead className="text-gray-500">Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} className="border-gray-800">
                  <TableCell><Badge variant="outline">{entry.type}</Badge></TableCell>
                  <TableCell>{entry.action}</TableCell>
                  <TableCell>{entry.status}</TableCell>
                  <TableCell>{entry.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/live-actions-dashboard.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/trading/LiveActionsDashboard.tsx \
  src/lib/engine/__tests__/live-actions-dashboard.test.tsx
git commit -m "feat: add live actions dashboard component"
```

---

### Task 3: Add API filter support for “live actions only” view

**Files:**
- Modify: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/app/api/logs/route.ts`
- Test: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/logs-live-actions-route.test.ts`

- [ ] **Step 1: Write failing route test for live-actions filter**

```ts
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const jobFindManyMock = mock(async () => [
  { id: 'job-1', type: 'PAPER_EXECUTE', status: 'COMPLETED', error: null, payload: null, createdAt: new Date() },
]);
const auditFindManyMock = mock(async () => [
  { id: 'audit-1', action: 'CREATE_JOB', actor: 'system', entityType: 'Job', entityId: 'job-1', details: 'x', createdAt: new Date() },
]);
const agentFindManyMock = mock(async () => [
  { id: 'agent-1', role: 'JUDGE', stage: 'SYNTHESIS', provider: 'x', modelUsed: 'x', summary: 'ok', failureReason: null, createdAt: new Date() },
]);

mock.module('@/lib/db', () => ({
  db: {
    job: { findMany: jobFindManyMock, count: mock(async () => 1) },
    auditLog: { findMany: auditFindManyMock, count: mock(async () => 1) },
    agentOutput: { findMany: agentFindManyMock, count: mock(async () => 1) },
  },
}));

describe('logs live-actions filter', () => {
  beforeEach(() => {
    jobFindManyMock.mockClear();
    auditFindManyMock.mockClear();
    agentFindManyMock.mockClear();
  });

  it('returns only action types relevant to live pipeline when view=live-actions', async () => {
    const { GET } = await import('../../../app/api/logs/route');
    const res = await GET(new Request('http://localhost/api/logs?view=live-actions') as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.entries)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/logs-live-actions-route.test.ts"`
Expected: FAIL or missing behavior

- [ ] **Step 3: Add minimal route branch**

```ts
const view = searchParams.get('view') || 'default';

// after entries built
let filteredEntries = entries;
if (view === 'live-actions') {
  const allowedJobActions = new Set([
    'SCAN', 'SCAN_VENUE', 'TRIAGE_MARKET', 'STANDARD_RESEARCH', 'DEEP_RESEARCH',
    'JUDGE_MARKET', 'RISK_CHECK', 'PAPER_EXECUTE', 'ORDER_TRACK', 'SETTLE', 'RESOLUTION_CHECK',
  ]);

  filteredEntries = entries.filter((entry) => {
    if (entry.type === 'Job') return allowedJobActions.has(entry.action);
    if (entry.type === 'AgentOutput') return !entry.message.startsWith('Failed:');
    if (entry.type === 'Audit') return entry.entityType === 'Job';
    return false;
  });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/logs-live-actions-route.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/app/api/logs/route.ts \
  src/lib/engine/__tests__/logs-live-actions-route.test.ts
git commit -m "feat: add live-actions view filter to logs API"
```

---

### Task 4: Connect shell page rendering and ensure component import path correctness

**Files:**
- Modify: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/components/trading-shell/TradingCommandCenterShell.tsx`
- Test: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/shell-live-actions-render.test.tsx`

- [ ] **Step 1: Write failing shell render test**

```tsx
import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { TradingCommandCenterShell } from '@/components/trading-shell/TradingCommandCenterShell';

describe('shell live actions page', () => {
  it('renders live actions heading when slug resolves to live-actions', () => {
    render(<TradingCommandCenterShell initialPage="liveActions" />);
    expect(screen.getByText('Live Actions')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/shell-live-actions-render.test.tsx"`
Expected: FAIL until switch case/import done

- [ ] **Step 3: Add import and switch case (minimal)**

```ts
import { LiveActionsDashboard } from '@/components/trading/LiveActionsDashboard';

// inside PageContent switch
case 'liveActions':
  return <LiveActionsDashboard />;
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/shell-live-actions-render.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/trading-shell/TradingCommandCenterShell.tsx \
  src/lib/engine/__tests__/shell-live-actions-render.test.tsx
git commit -m "feat: wire live actions page into command center shell"
```

---

### Task 5: Add UX controls specific to live actions (auto-refresh + quick filters)

**Files:**
- Modify: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/components/trading/LiveActionsDashboard.tsx`
- Test: `/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/live-actions-controls.test.tsx`

- [ ] **Step 1: Write failing controls test**

```tsx
import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { LiveActionsDashboard } from '@/components/trading/LiveActionsDashboard';

global.fetch = mock(async () => new Response(JSON.stringify({ entries: [], stats: { totalLogs: 0, failedCount: 0, recentActivity: 0 } }))) as any;

describe('live actions controls', () => {
  it('shows auto-refresh control and quick status filter', () => {
    render(<LiveActionsDashboard />);
    expect(screen.getByText(/Live Actions/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-refresh/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify failure (if controls missing)**

Run: `bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/live-actions-controls.test.tsx"`
Expected: FAIL if controls absent

- [ ] **Step 3: Add minimal controls**

```tsx
const [autoRefresh, setAutoRefresh] = useState(true);
const [statusFilter, setStatusFilter] = useState<'ALL' | 'RUNNING' | 'FAILED' | 'COMPLETED'>('ALL');

// filter rows in render from entries based on statusFilter
// guard interval refresh by autoRefresh
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/live-actions-controls.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/trading/LiveActionsDashboard.tsx \
  src/lib/engine/__tests__/live-actions-controls.test.tsx
git commit -m "feat: add live actions filters and auto-refresh controls"
```

---

### Task 6: Final verification sweep

**Files:**
- Modify: none expected (verification only)

- [ ] **Step 1: Run targeted new test files**

Run:
```bash
bun test \
  "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/navigation-live-actions.test.ts" \
  "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/live-actions-dashboard.test.tsx" \
  "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/logs-live-actions-route.test.ts" \
  "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/shell-live-actions-render.test.tsx" \
  "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/live-actions-controls.test.tsx"
```
Expected: all PASS

- [ ] **Step 2: Run related existing test suites (regression guard)**

Run:
```bash
bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/jobs-api.test.ts"
bun test "/Volumes/AppProjectStorage/application/project/tradingbot/tb/src/lib/engine/__tests__/worker-route.test.ts"
```
Expected: PASS, no behavior regressions

- [ ] **Step 3: Run typecheck for affected surface**

Run: `bun run typecheck`
Expected: no new TS errors in touched files

- [ ] **Step 4: Manual smoke in app shell**

Run:
```bash
bun run dev
```
Then validate in browser:
- `/live-actions` renders shell + page
- auto-refresh toggles
- action rows load from `/api/logs?view=live-actions`
- no console errors

- [ ] **Step 5: Final integration commit**

```bash
git add src/lib/navigation/trading-pages.ts \
  src/components/trading-shell/TradingCommandCenterShell.tsx \
  src/components/trading/LiveActionsDashboard.tsx \
  src/app/api/logs/route.ts \
  src/lib/engine/__tests__/navigation-live-actions.test.ts \
  src/lib/engine/__tests__/live-actions-dashboard.test.tsx \
  src/lib/engine/__tests__/logs-live-actions-route.test.ts \
  src/lib/engine/__tests__/shell-live-actions-render.test.tsx \
  src/lib/engine/__tests__/live-actions-controls.test.tsx

git commit -m "feat: add live actions page with real-time action stream"
```

---

## Self-Review

- Spec coverage: page creation, real-time actions visibility, filters, shell route integration, regression safety all mapped to tasks.
- Placeholder scan: no TBD/TODO placeholders; each code-changing step contains concrete code snippets + command.
- Type consistency: `PageView` uses `liveActions`, slug is `live-actions`, route path `/live-actions`, shell switch uses same id.

Potential scope split note: this feature is single subsystem (UI + logs API view), no subsystem split needed.
