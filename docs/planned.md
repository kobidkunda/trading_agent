# PRODUCT_SPEC.md

## Product Name

Trading Command Center

## One-Line Summary

A Dockerized, self-hosted, production-focused prediction-market research, triage, decision-support, and execution platform with a dedicated GUI, deterministic risk engine, full auditability, and memory-backed learning.

---

## 1. Purpose

Trading Command Center is a dedicated application for scanning prediction markets, triaging opportunities, running structured research with agents, estimating true probabilities, deciding whether to buy or skip using deterministic risk rules, recording outcomes, and learning from historical decisions.

The product must support both:

* fully local/self-hosted components where practical
* external managed services where useful or lower-friction

The product is not a generic workflow builder. It is a purpose-built system for:

* market triage
* research orchestration
* probability estimation
* risk-controlled execution
* full logging of skipped reasons, trade reasons, prompts, research inputs, and outcomes

---

## 2. Core Product Goals

### 2.1 Primary Goals

* Provide a central GUI for all market triage, research, decisions, and outcomes.
* Support Dockerized deployment with a CLI setup wizard.
* Use deterministic code for risk rules and execution decisions.
* Use LLMs and agents only for research, synthesis, and structured probability estimation.
* Store complete market, research, decision, and outcome data for replay and learning.
* Support paper mode first, then controlled live execution.
* Make prompt versions, agent outputs, and skip reasons visible in the GUI.
* Minimize vendor lock-in.

### 2.2 Secondary Goals

* Support both local and external model providers.
* Support both local and cloud Qdrant / memory options.
* Enable human review and strategy tweaking without code edits.
* Build a reusable platform for multiple venues over time.

---

## 3. Non-Goals

* The product will not attempt to cover 100% of the public internet.
* The product will not let an LLM directly place orders without deterministic risk checks.
* The product will not rely on Dify as the core orchestration or ledger layer.
* The product will not use vector DB as the sole system of record.
* The product will not begin with a large swarm of many agent personas.
* The product will not launch live trading before paper-trading, audit trails, and safety controls are complete.

---

## 4. Target Users

### 4.1 Primary User

Internal operator / admin managing prediction-market strategies.

### 4.2 Secondary Users

* research operator
* strategy editor
* risk reviewer
* execution reviewer
* developer maintaining infrastructure

---

## 5. Core Principles

1. **Research can be agentic. Execution must be deterministic.**
2. **Postgres is the truth ledger.**
3. **Qdrant is research memory, not the primary ledger.**
4. **Every trade and every skip must have a reason code.**
5. **Every prompt must be versioned.**
6. **Paper mode first.**
7. **All critical actions must be auditable.**
8. **Optional services must be configurable as local or external.**
9. **Avoid duplicate responsibilities across Mem0, OpenViking, and Qdrant.**
10. **Prefer fewer robust agents over many overlapping agents.**

---

## 6. High-Level Architecture

### 6.1 Main Stack

* **Frontend GUI:** Next.js
* **Backend API:** FastAPI
* **Async Workers:** Celery + Redis
* **Main DB:** Postgres
* **Vector Memory:** Qdrant
* **Memory Policy Layer:** Mem0
* **Agent Context Layer:** OpenViking
* **Ops / Triage Agent:** Hermes
* **Deep Research Engine:** DeerFlow
* **Cheap Local Model:** Gemma 4 via Ollama
* **Hosted Reasoning Models:** Gemini 3.1 Pro and/or GPT-5.4 Pro
* **Search Discovery:** SearXNG
* **Targeted Extraction:** Firecrawl or equivalent crawler/extractor
* **Primary Venues:** Polymarket + Kalshi
* **Optional Later Venues:** SX Bet
* **Signal-Only Venues Later:** Manifold

### 6.2 Logical Layers

1. Setup and configuration layer
2. Market ingestion layer
3. Triage layer
4. Retrieval / memory layer
5. Research layer
6. Synthesis / judge layer
7. Deterministic risk engine
8. Execution layer
9. Settlement / learning layer
10. GUI / operator layer

---

## 7. Deployment Model

### 7.1 Deployment Style

Docker Compose-based monorepo deployment.

### 7.2 Setup Flow

User runs a CLI setup wizard before starting services.

The setup wizard generates:

* `.env`
* `.env.secrets`
* `docker-compose.override.yml`
* `runtime-config.json`
* initial admin bootstrap data

### 7.3 Compose Strategy

Use:

* one base `docker-compose.yml`
* one optional override
* compose profiles for optional services

Do **not** regenerate the full base compose on each run.

---

## 8. Setup Wizard Requirements

### 8.1 Wizard Name

`setup.sh` with Python helper(s)

### 8.2 Wizard Responsibilities

The setup wizard must:

* check Docker installation
* check Docker Compose availability
* check Python runtime if helper scripts need it
* detect GPU support if present
* check port availability
* prompt the user for local vs external services
* write environment and runtime config files
* generate secrets/encryption key if needed
* bootstrap admin credentials
* optionally run connection tests
* print exact next steps

### 8.3 Setup Questions

The wizard must ask for:

* local or external Qdrant
* local or external Mem0
* local or external Ollama
* local SearXNG or external search
* whether to enable DeerFlow
* whether to enable Hermes
* whether to enable OpenViking
* hosted LLM keys (Gemini, GPT)
* venue credentials (Polymarket, Kalshi)
* dry-run only or live-capable mode
* global default risk settings
* local hostnames / domains / bind addresses if needed

### 8.4 Setup Outputs

The wizard must produce:

* valid config files
* selectable compose profiles
* initial DB seed settings
* initial strategy defaults
* initial prompt templates

---

## 9. Services

### 9.1 Always-On Services

* `frontend-gui`
* `backend-api`
* `postgres-db`
* `redis-cache`
* `worker-scanner`
* `worker-triage`
* `worker-research`
* `worker-judge`
* `worker-execution`
* `worker-settlement`

### 9.2 Optional Local Services

* `qdrant-vector`
* `ollama-local`
* `searxng`
* `mem0-local`
* `openviking`
* `flower`

### 9.3 External Services

* Gemini API
* GPT API
* external Ollama
* Qdrant Cloud
* managed Mem0
* external search providers if configured

---

## 10. Monorepo Structure

```text
trading-command-center/
  apps/
    frontend/
    backend/
  workers/
    scanner/
    triage/
    research/
    judge/
    execution/
    settlement/
  packages/
    shared-schemas/
    prompt-templates/
    venue-clients/
    risk-engine/
    memory-layer/
  infra/
    docker/
    compose/
    migrations/
    monitoring/
  scripts/
    setup.sh
    bootstrap.py
    smoke_test.py
  docs/
    architecture.md
    api-contracts.md
    env-reference.md
    ops-runbook.md
```

---

## 11. Product Workflows

### 11.1 Main End-to-End Flow

1. Setup wizard generates runtime configuration.
2. Scanner pulls market data from venues.
3. Market snapshots are stored in Postgres.
4. Deterministic pre-filter removes obviously bad opportunities.
5. Gemma local triage classifies candidates and records reason.
6. Retrieval layer pulls similar past context from Qdrant / Mem0 / OpenViking.
7. Search and extraction gather current evidence.
8. DeerFlow research sub-agents run only for shortlisted candidates.
9. Bull, Bear, Contradiction, and Judge outputs are generated.
10. Judge returns structured probability output.
11. Deterministic risk engine computes edge, size, and buy/skip.
12. Execution worker places simulated or real order.
13. Outcome is tracked until resolution.
14. Postmortem is generated and stored.
15. Learning signals are written back to memory stores.

### 11.2 Safety Rule

No market may reach execution without passing through:

* deterministic pre-filter
* structured judge output validation
* deterministic risk engine

---

## 12. Agent Roles

### 12.1 Scanner Agent

Responsibilities:

* fetch venue markets
* normalize metadata
* save snapshots
* enqueue triage

### 12.2 Triage Agent

Responsibilities:

* run cheap model screening
* classify relevance
* classify ambiguity
* generate one-line skip/accept reason

### 12.3 Retrieval Agent

Responsibilities:

* query Qdrant for similar markets and theses
* pull relevant compact memories from Mem0
* pull resource/context items from OpenViking

### 12.4 Bull Agent

Responsibilities:

* argue the strongest case for entering the trade

### 12.5 Bear Agent

Responsibilities:

* argue the strongest case against entering the trade

### 12.6 Contradiction Agent

Responsibilities:

* find disconfirming evidence
* force adversarial review of thesis

### 12.7 Judge Agent

Responsibilities:

* synthesize structured final estimate
* return schema-validated output only

### 12.8 Risk Engine

Responsibilities:

* deterministic decision logic only
* no freeform generation

### 12.9 Execution Agent

Responsibilities:

* submit orders or paper trades
* sync fills and state
* reconcile venue state

### 12.10 Settlement Agent

Responsibilities:

* detect resolution
* compute P&L
* generate postmortem
* write learnings back

### 12.11 Hermes Ops Agent

Responsibilities:

* monitor workers
* summarize failures
* surface stale queues
* alert on broken connections/configs

---

## 13. Data and Memory Strategy

### 13.1 Role Split

* **Postgres:** structured truth ledger
* **Qdrant:** research chunks, theses, postmortem pattern retrieval
* **Mem0:** compact long-term memory / memory policy
* **OpenViking:** agent-readable context, skills, resources, playbooks

### 13.2 Important Constraint

Do not duplicate all raw data into all memory systems.
Each layer must have a specific role.

---

## 14. Postgres Schema Requirements

### 14.1 Required Tables

* `markets`
* `market_snapshots`
* `trade_candidates`
* `research_runs`
* `research_sources`
* `agent_outputs`
* `decisions`
* `orders`
* `fills`
* `positions`
* `outcomes`
* `postmortems`
* `prompt_templates`
* `credentials`
* `settings`
* `audit_logs`
* `jobs`

### 14.2 Table Intent

#### `markets`

Stores static or slow-changing market metadata.

#### `market_snapshots`

Stores time-series market state:

* implied probability
* liquidity
* spread
* volume
* timestamp

#### `trade_candidates`

Stores candidates that passed scanning and entered triage/research.

#### `research_runs`

Stores one row per research workflow execution.

#### `research_sources`

Stores all discovered sources and extracted evidence references.

#### `agent_outputs`

Stores Bull/Bear/Judge/Triage/other outputs, model used, prompt version, timestamps.

#### `decisions`

Stores final deterministic decision and reason codes.

#### `orders`

Stores submitted orders and their lifecycle state.

#### `fills`

Stores partial or complete fill records.

#### `positions`

Stores open and closed positions.

#### `outcomes`

Stores resolution and final realized results.

#### `postmortems`

Stores reflective analysis after settlement.

#### `prompt_templates`

Stores editable prompt versions and publish state.

#### `credentials`

Stores encrypted credentials.

#### `settings`

Stores strategy and system settings.

#### `audit_logs`

Stores security-sensitive or operator-sensitive changes.

#### `jobs`

Stores long-running background job state.

---

## 15. Qdrant Collection Requirements

### 15.1 Required Collections

* `research_chunks`
* `market_theses`
* `postmortem_patterns`
* `entity_context` (optional but recommended)

### 15.2 Collection Intent

#### `research_chunks`

Stores embedded raw extracted evidence chunks.

#### `market_theses`

Stores embedded thesis summaries and structured final judgments.

#### `postmortem_patterns`

Stores reusable win/loss patterns and failure types.

#### `entity_context`

Stores reusable context on recurring entities, teams, candidates, projects, etc.

---

## 16. GUI Requirements

The GUI must be built in Next.js and function as the operator-facing control center.

### 16.1 Required Pages

* Strategy Hub
* Credential Manager
* Live Market Triage
* Research Ledger
* Prompt Studio
* System Health

### 16.2 Strategy Hub

Must allow operators to configure:

* enabled venues
* enabled categories
* minimum liquidity
* target edge
* maximum spread
* max exposure per market
* max daily exposure
* research escalation threshold
* dry-run/live toggle
* prompt set selection

### 16.3 Credential Manager

Must allow operators to:

* save credentials securely
* test connections
* mask secrets in UI
* see credential health status

The GUI must not display raw secrets after save.

### 16.4 Live Market Triage

Must show a table with:

* market name
* venue
* liquidity
* spread
* implied probability
* triage status
* triage reason
* queued-for-research status
* current pipeline stage

### 16.5 Research Ledger

Must show a table with:

* market ID
* venue
* predicted true probability
* market implied probability
* estimated edge
* decision
* decision reason
* current position
* final outcome
* realized P&L

Expanding a row must show:

* bull output
* bear output
* contradiction output
* judge output
* memory context used
* evidence/source list
* prompt version
* execution log
* postmortem

### 16.6 Prompt Studio

Must allow:

* editing prompt templates
* versioning
* draft vs published states
* rollback
* diff view
* audit trail of changes

### 16.7 System Health

Must show:

* queue depth
* failing jobs
* stale jobs
* venue connection health
* DB health
* vector DB health
* model provider health
* last scan timestamps
* execution mode status

---

## 17. API Requirements

The backend API must be built in FastAPI.

### 17.1 Required API Domains

* auth/session
* config/settings
* credentials
* market read APIs
* research/job APIs
* prompt APIs
* decision APIs
* ledger APIs
* admin/health APIs

### 17.2 API Behavior Requirements

* all mutation endpoints must be audited where relevant
* all sensitive responses must redact secrets
* all background-triggering endpoints must return job IDs
* all structured LLM outputs must be schema-validated before persistence

---

## 18. Worker Responsibilities

### 18.1 Scanner Worker

* fetch markets
* normalize data
* save snapshots
* enqueue triage jobs

### 18.2 Triage Worker

* apply deterministic screening rules
* call Gemma local or configured cheap model
* save accept/reject and reason code
* enqueue research if needed

### 18.3 Research Worker

* run search discovery
* run targeted extraction
* store evidence references
* ingest chunks into Qdrant
* prepare research context package

### 18.4 Judge Worker

* run Bull/Bear/Contradiction/Judge
* validate JSON schema
* save structured thesis output

### 18.5 Execution Worker

* run paper or live execution
* ensure idempotent order submission
* sync fills and position state

### 18.6 Settlement Worker

* detect resolution
* compute P&L
* generate postmortem
* write learning signals back

---

## 19. Research Pipeline Requirements

### 19.1 Search Strategy

The system must use a staged search strategy:

1. broad discovery
2. evidence selection
3. extraction and normalization
4. recency scoring
5. source trust scoring
6. contradiction search

### 19.2 Source Expectations

The system should support:

* web pages
* news
* social discussions where available
* forum-like discussions where available
* venue-specific commentary/signals later if added

### 19.3 Constraint

The product should aim for broad, production-usable coverage, not impossible “full internet” coverage.

### 19.4 Retrieval Expectations

The system must recall:

* similar markets
* prior theses
* related failures
* similar entities
* recurring patterns

---

## 20. Judge Output Schema Requirements

Judge output must be strict JSON and include at minimum:

* `estimated_true_probability`
* `confidence_score`
* `supporting_evidence_summary`
* `opposing_evidence_summary`
* `uncertainty_penalty`
* `freshness_score`
* `source_quality_score`
* `catalyst_window`
* `recommended_action_context`
* `skip_reason_if_applicable`

This output must be validated before use by the risk engine.

---

## 21. Risk Engine Requirements

The risk engine must be a standalone deterministic module.

### 21.1 Inputs

* market implied probability
* judge estimated true probability
* confidence
* uncertainty penalty
* fees
* slippage allowance
* category exposure
* daily exposure
* correlated exposure
* venue constraints
* market timing constraints

### 21.2 Outputs

* buy or skip
* size cap
* urgency
* reason code(s)
* requires manual review boolean

### 21.3 Reason Codes

The system must support standardized reason codes, including:

* `LOW_LIQUIDITY`
* `WIDE_SPREAD`
* `LOW_EDGE`
* `LOW_CONFIDENCE`
* `HIGH_UNCERTAINTY`
* `CATALYST_TOO_CLOSE`
* `CATEGORY_DISABLED`
* `DAILY_LIMIT_REACHED`
* `CORRELATED_RISK`
* `MANUAL_REVIEW_REQUIRED`

### 21.4 Constraint

No LLM may override the deterministic risk engine.

---

## 22. Execution Requirements

### 22.1 Modes

The system must support:

* paper mode
* live mode

### 22.2 Default

Paper mode is the default.

### 22.3 Live Safety

Live execution must require:

* explicit enablement
* valid credentials
* venue connection health
* risk engine approval
* system not in emergency stop mode

### 22.4 Execution Safety

Execution must be:

* idempotent
* retry-safe
* reconcilable with venue state
* auditable

---

## 23. Settlement and Learning Requirements

### 23.1 Settlement Responsibilities

* detect when a market resolves
* settle positions
* calculate realized P&L
* compare forecast vs actual

### 23.2 Postmortem Requirements

Each settled market should produce a postmortem that includes:

* expected probability vs actual result
* entry conditions
* whether the thesis held
* which evidence mattered most
* whether the risk engine helped or hurt
* repeated mistake tags if present

### 23.3 Learning Writeback

The system must write useful learnings back into:

* Qdrant postmortem patterns
* Mem0 compact memory where appropriate
* OpenViking approved notes/playbooks where appropriate

---

## 24. Prompt Management Requirements

### 24.1 Prompt Types

At minimum, prompt templates must exist for:

* triage
* bull
* bear
* contradiction
* judge
* postmortem

### 24.2 Prompt Controls

Operators must be able to:

* create draft prompts
* publish prompts
* roll back to previous versions
* inspect diffs
* see which prompt version produced which output

### 24.3 Prompt Safety

Prompt changes must be auditable.

---

## 25. Security Requirements

### 25.1 Secrets

* secrets must never be logged in plaintext
* secrets stored in DB must be encrypted at rest
* GUI must mask secret values after input
* `.env` is bootstrap-oriented, not the main runtime secret store for production GUI changes

### 25.2 Auditability

The system must log:

* prompt changes
* strategy changes
* credential changes
* live mode toggles
* emergency stop usage
* execution-triggering actions

### 25.3 Access

Role-based access is recommended, even if basic at first.

---

## 26. Reliability Requirements

The system must support:

* retries with limits
* stale job detection
* queue monitoring
* health checks
* partial failure handling
* external provider timeout handling
* schema validation failures
* venue adapter failure isolation

All long-running jobs must have:

* status
* timestamps
* retry count
* error payloads
* correlation ID

---

## 27. Observability Requirements

### 27.1 Logging

Use structured logs.

### 27.2 Minimum Monitoring

The system must expose:

* service health
* queue depth
* worker failures
* scan freshness
* order submission failures
* model provider failures
* DB health
* Qdrant health

### 27.3 Optional Later

Prometheus/Grafana integration may be added later.

---

## 28. Testing Requirements

### 28.1 Unit Tests

Must cover:

* risk engine
* schema validation
* config loading
* encryption routines
* venue adapters

### 28.2 Integration Tests

Must cover:

* scanner to triage
* triage to research
* research to judge
* judge to risk engine
* risk engine to execution in paper mode
* settlement pipeline

### 28.3 Replay Tests

The system should support replaying historical markets and decisions.

### 28.4 Failure Tests

Must test:

* provider timeouts
* Qdrant unavailable
* invalid LLM JSON
* duplicate order attempts
* partial fills
* degraded search results

---

## 29. Release Strategy

### 29.1 Phase 1

Infrastructure bootstrap and GUI shell.

### 29.2 Phase 2

Market ingestion and triage.

### 29.3 Phase 3

Research and retrieval pipeline.

### 29.4 Phase 4

Judge outputs and deterministic risk engine.

### 29.5 Phase 5

Paper-trading execution.

### 29.6 Phase 6

Settlement and learning.

### 29.7 Phase 7

Live execution with hard safety controls.

---

## 30. Implementation Phases

### Phase 0 — Architecture Freeze

Deliverables:

* repo skeleton
* architecture docs
* config strategy
* service map
* queue naming
* schema plan

### Phase 1 — Infrastructure Bootstrap

Deliverables:

* base compose
* setup wizard
* backend/frontend containers
* Postgres + Redis up
* health checks

### Phase 2 — Backend Foundation

Deliverables:

* FastAPI app
* migrations
* auth/session
* config APIs

### Phase 3 — Secrets & Credentials

Deliverables:

* encrypted credential storage
* test connection endpoints
* audit logging for updates

### Phase 4 — Market Ingestion

Deliverables:

* Polymarket adapter
* Kalshi adapter
* scanner worker
* snapshot storage

### Phase 5 — Triage Pipeline

Deliverables:

* deterministic filters
* Gemma triage
* reason codes
* triage views in GUI

### Phase 6 — Research Pipeline

Deliverables:

* discovery
* extraction
* Qdrant ingestion
* retrieval wrappers

### Phase 7 — Debate and Judge Flow

Deliverables:

* Bull/Bear/Contradiction/Judge
* structured output
* prompt version tracking

### Phase 8 — Risk Engine

Deliverables:

* deterministic edge logic
* sizing logic
* exposure controls
* decision reasons

### Phase 9 — Paper Execution

Deliverables:

* paper trading engine
* simulated fills
* reconciliation

### Phase 10 — Settlement & Learning

Deliverables:

* resolution checker
* P&L pipeline
* postmortem generation
* writeback to memory

### Phase 11 — GUI Completion

Deliverables:

* all pages live
* expand panels
* filters and search
* Prompt Studio
* System Health

### Phase 12 — Hardening

Deliverables:

* structured logging
* alerts
* backups
* stale-job handling
* production runbook

---

## 31. Acceptance Criteria

The product is acceptable for initial production paper-use when:

* setup wizard completes on a fresh machine
* stack boots with Docker Compose
* GUI loads and shows system health
* scanner continuously ingests markets
* triage runs and stores reason codes
* research pipeline stores evidence and retrieval context
* judge returns schema-validated output
* risk engine returns deterministic decisions
* paper execution can simulate orders safely
* every decision and skip is visible in GUI
* every critical config/prompt change is audited
* settlement and postmortem pipeline works for resolved markets

The product is acceptable for controlled live execution only when:

* all paper-mode criteria pass
* live-mode safeguards are complete
* credential storage is secure
* idempotent execution is verified
* emergency stop works
* audit logs are reliable

---

## 32. Recommended Build Order for Coding Agent

1. monorepo skeleton
2. base Docker compose and setup wizard
3. backend health, config, auth
4. Postgres schema and migrations
5. frontend shell with page scaffolding
6. venue ingestion adapters
7. triage pipeline
8. retrieval and Qdrant integration
9. DeerFlow debate flow
10. deterministic risk engine
11. paper trading execution
12. ledger and postmortems
13. credential manager and encryption
14. prompt studio
15. observability and hardening

---

## 33. Initial Defaults

### 33.1 Default Execution Mode

* paper mode enabled
* live mode disabled

### 33.2 Default Model Routing

* Gemma local for triage
* hosted strong model for judge
* DeerFlow only for shortlisted opportunities

### 33.3 Default Venue Scope

* Polymarket
* Kalshi

### 33.4 Default Safety

* emergency stop available
* manual review path supported
* all live actions audited

---

## 34. Future Extensions

Not required for first release, but possible later:

* more venues
* portfolio-level hedging logic
* correlated market clustering
* advanced replay engine
* richer role-based access control
* alerting integrations
* advanced analytics dashboards
* prompt performance scoring

---

## 35. Final Product Statement

Trading Command Center is a dedicated, self-hosted, modular prediction-market operating system built for robust market triage, explainable research, deterministic execution control, and continuous learning. It combines agentic research with strict risk control, provides full visibility into skipped and executed decisions, and is designed for production-first operation rather than prototype-only experimentation.
