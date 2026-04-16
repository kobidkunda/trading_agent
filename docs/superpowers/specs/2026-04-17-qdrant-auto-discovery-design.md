# Qdrant Auto-Discovery & Collection Management

**Date**: 2026-04-17
**Status**: Draft

## Problem

The app defines Qdrant in `docker-compose.yml` and as a credential in `CredentialManager`, but nothing actually creates or manages collections. When a user connects a Qdrant instance, there's no way to discover what collections exist, create the needed ones, or configure vector dimensions. The feature is infrastructure without application logic.

## Solution

When a Qdrant credential tests successfully, auto-discover existing collections and match them against 3 expected defaults (`research_memory`, `market_search`, `trade_history`). Present a step-form wizard to confirm creation of missing collections with configurable names, vector dimensions, and distance metrics. Provide inline status in CredentialManager and a dedicated VectorDB page for ongoing management.

## Architecture

### Flow

1. User adds Qdrant credential in CredentialManager
2. User clicks "Test" → connection succeeds
3. Auto-discover fires: `POST /api/qdrant/discover` using stored credential URL/key
4. Wizard opens showing found vs missing collections
5. User configures missing collections (names, dimensions, distance metric)
6. User confirms → collections created, links stored in Settings

### Components

```
CredentialManager (existing, modified)
  └─ Qdrant card gains: collection status dots, "Manage Collections" button
  └─ QdrantSetupWizard (new Dialog)
       Step 1: Discovery (show found/missing)
       Step 2: Configure (names, dims, distance)
       Step 3: Create & Link (progress per collection)

VectorDB page (new)
  └─ Instance connection status
  └─ Collection cards (name, points, config, status)
  └─ Actions: create, delete, refresh
```

### Data Storage

Collection links stored in existing `Settings` table:
- Key: `qdrant_collections_{credentialId}`
- Value: `{ researchMemory: "research_memory", marketSearch: "market_search", tradeHistory: "trade_history" }`

No Prisma schema changes required.

## API Design

### New Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/qdrant/collections` | GET | List all collections on connected Qdrant |
| `/api/qdrant/collections` | POST | Create a collection |
| `/api/qdrant/collections/[name]` | GET | Single collection details |
| `/api/qdrant/collections/[name]` | DELETE | Delete a collection |
| `/api/qdrant/discover` | POST | Auto-discover + match against expected defaults |

All calls proxy through Next.js API routes using the stored credential's `serviceUrl` and `encryptedData`.

### Discover Response

```json
{
  "connected": true,
  "instanceInfo": { "version": "1.8.0", "mode": "standalone" },
  "collections": [
    {
      "name": "research_memory",
      "vectorsCount": 1204,
      "status": "green",
      "vectorConfig": { "size": 1536, "distance": "Cosine" }
    }
  ],
  "expectedDefaults": {
    "researchMemory": { "found": true, "name": "research_memory" },
    "marketSearch": { "found": false },
    "tradeHistory": { "found": false }
  }
}
```

## Collection Schemas

| Collection Key | Default Name | Vector Dims | Distance | Payload Indexes | Purpose |
|---|---|---|---|---|---|
| `researchMemory` | `research_memory` | 768 (Ollama) / 1536 (OpenAI) | Cosine | `marketId`, `role`, `depth`, `createdAt` | Research run outputs, agent analysis, RAG retrieval |
| `marketSearch` | `market_search` | 768 / 1536 | Cosine | `venue`, `category`, `status`, `createdAt` | Market title/description embeddings for semantic search |
| `tradeHistory` | `trade_history` | 768 / 1536 | Cosine | `marketId`, `action`, `side`, `outcome`, `createdAt` | Trade decision embeddings for pattern matching |

Vector dimensions are configurable. Embedding provider selection (OpenAI vs Ollama vs Custom) sets default dimensions.

## UI Design

### QdrantSetupWizard (3-step Dialog)

**Step 1 — Discovery:**
- Shows Qdrant instance info (version, mode)
- Lists all discovered collections with status, vector count, config
- Shows expected defaults with found/missing badges
- "Next" enabled only if at least one collection is missing

**Step 2 — Configure:**
- Embedding provider selector: OpenAI (1536d) | Ollama (768d) | Custom (manual dims)
- Per missing collection: editable name (pre-filled with default), auto-set dims, distance metric selector
- Existing collections shown read-only (already linked)

**Step 3 — Create & Link:**
- Summary of what will be created
- "Create Collections" button
- Per-collection progress: ✓ success / ✗ failure
- On success: links stored in Settings, wizard closes, card updates

### CredentialManager Inline Changes

- Below Qdrant card test result: 3 collection status dots (green=linked, gray=missing, amber=unlinked)
- "Manage Collections" button re-opens wizard
- Dots have tooltips with collection names and status

### VectorDB Page (new sidebar page)

- Top: Qdrant instance connection status (reuses credential test result)
- Collection cards: name, points count, vector config, status indicator
- Actions: create new collection, delete collection, refresh stats
- Each card expandable: payload schema, recent points sample

## File Changes

### New Files
- `src/app/api/qdrant/collections/route.ts` — GET (list), POST (create)
- `src/app/api/qdrant/collections/[name]/route.ts` — GET (info), DELETE (drop)
- `src/app/api/qdrant/discover/route.ts` — POST (auto-discover)
- `src/components/trading/QdrantSetupWizard.tsx` — 3-step wizard dialog
- `src/components/trading/VectorDB.tsx` — VectorDB page component

### Modified Files
- `src/components/trading/CredentialManager.tsx` — collection status dots, "Manage Collections" button
- `src/app/page.tsx` — add `vectorDb` PageView + sidebar nav item
- `src/store/trading-store.ts` — add `vectorDb` to PageView type
- `src/lib/types/index.ts` — add Qdrant collection types
- `src/lib/constants/index.ts` — add default collection definitions

### No Changes
- `prisma/schema.prisma` — no schema modifications needed