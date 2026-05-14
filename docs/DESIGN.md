# Trading Command Center - Design System

## Overview
Production-grade autonomous prediction market trading system with dark-themed dashboards, real-time agent monitoring, and comprehensive data visualization.

---

## Core Design Philosophy

### Dark Industrial Aesthetic
- Deep charcoal gray backgrounds (`gray-950`, `gray-900`)
- Accent colors that denote status (emerald for success/positive, amber for warning, red for danger/stopped, cyan for info)
- Professional trading terminal feel with high contrast for data visibility
- Subtle glass-morphism with `backdrop-blur` on overlays

### Information Density
- Single-page dashboard with collapsible sections
- Every action visible without extensive navigation
- Real-time indicators (pulsing badges, animated status icons)
- Data tables for structured information with inline expand details

### Agent-Centric Visualization
- Color-coded agent roles (BULL/Bear/Judge/Debate/etc)
- Pipeline stage visualization with status tracking
- Parallel-agent execution display
- Transparency in source tracking and confidence scoring

---

## Color Palette

### Base Colors
```css
/* Backgrounds */
bg-gray-950: #030712;      /* Primary background */
bg-gray-900: #111827;      /* Card/section backgrounds */
bg-gray-800: #1f2937;      /* Elevated surfaces, inputs */
bg-gray-800/50: #1f293780; /* Subtle elevated surfaces */
border-gray-800: #1f2937;  /* Card borders */
border-gray-700: #374151;  /* Input borders, dividers */

/* Primary Accent (Trading/Technology) */
emerald-400: #34d399;      /* Success, positive edge, LIVE */
emerald-500/10: #10b9811a; /* Badge backgrounds */
emerald-600/20: transparent;/* Logo/icon container */

/* Secondary Accent (Info/Data) */
cyan-400: #22d3ee;         /* Info labels, judge output, links */
blue-400: #60a5fa;         /* Live processing, X/Twitter sources */
violet-400: #a78bfa;     /* Agent pipeline, triage */

/* Semantic Colors */
amber-400: #fbbf24;        /* Warning, contradict/dry-run mode */
red-400: #f87171;          /* Danger, stopped, negative */
purple-400: #c084fc;       /* Agent-reach, synthesis */
orange-400: #fb923c;       /* Reddit, Fire (pipeline) */
```

### Agent Role Colors
```
TRIAGE:     violet (text-violet-400 border-violet-500/30 bg-violet-500/10)
BULL:       emerald (text-emerald-400 border-emerald-500/30 bg-emerald-500/10)
BEAR:       red (text-red-400 border-red-500/30 bg-red-500/10)
CONTRADICTION: amber (text-amber-400 border-amber-500/50 bg-amber-500/20)
JUDGE:      cyan (text-cyan-400 border-cyan-500/50 bg-cyan-500/20)
DEERFLOW:   indigo (text-indigo-400 border-indigo-500/30 bg-indigo-500/10)
```

### Stage Status Colors
```
running:    blue (animate-spin indicator)
completed:  emerald
failed:     red
skipped:    amber
timeout:    amber
```

---

## Typography

### Font Stack
- **System default** - No custom fonts (Inter fallback via Tailwind)
- **Monospace** - `font-mono` for numbers, timestamps (tabular-nums for alignment)

### Scale
```
text-[10px]:  Labels, metadata, source 
text-xs:      Secondary text, descriptions, table headers
text-sm:      Body text, market titles, primary data
text-base:    Navigation labels
```

### Weights & Tracking
- **Bold (700)**: Statistics ($5.2K), section headers
- **Semibold (600)**: Table headers, active nav items, labels
- **Medium (500)**: Navigation items, card titles
- **Normal (400)**: Body text
- **tracking-tight**: Tightly-spaced display text (app title)
- **tracking-wider**: Status labels (uppercase), footer labels
- **uppercase**: Status badges, section headers

---

## Components

### Cards
```tsx
<Card className="border-gray-800 bg-gray-900">
  <CardContent className="p-4">
    {/* Content */}
  </CardContent>
</Card>
```
- Border radius: default (rounded-lg)
- Shadow: minimal/none (dark theme provides separation)
- Padding: varies by usage (p-4 standard)

### Data Tables
```css
/* Table row hover */
hover:bg-gray-800/50;

/* Expanded row background */
bg-gray-900/80;

/* Table header */
text-gray-500 (muted headers)
```

### Badges (Status/Tags)
```css
/* Standard stat badge */
text-[10px] border-gray-700 bg-gray-800 text-gray-400

/* Status badge with color */
text-[10px] border-{color}-500/30 bg-{color}-500/10 text-{color}-400

/* Animated agent badge */
animate-pulse border-emerald-500/30 bg-emerald-500/20 text-emerald-400
```

### Buttons
```tsx
// Primary action (ghost, subtle in table)
<Button variant="ghost" size="sm" className="text-gray-300 hover:bg-gray-800" />

// Destructive action (stop/kill)
<Button variant="destructive" size="sm" />

// Navigation active state
text-emerald-400 bg-emerald-600/15

// Outline variant (credentials, actions)
<Button variant="outline" className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10" />
```

### Inputs
```tsx
<Input className="border-gray-700 bg-gray-800 text-white placeholder:text-gray-600" />

// Search with icon
<div className="relative flex-1">
  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
  <Input className="pl-9 ..." />
</div>
```

### Selecting/Select
```tsx
<SelectTrigger className="w-36 border-gray-700 bg-gray-800 text-gray-300">
  <SelectContent className="border-gray-700 bg-gray-900">
    <SelectItem>...</SelectItem>
  </SelectContent>
</Select>
```

### Expandable Sections
```tsx
<button
  onClick={() => setExpanded(!expanded)}
  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-800/50 rounded-lg"
>
  <div className="flex items-center gap-2">
    {/* Icon + Title */}
  </div>
  {isExpanded ? <ChevronDown /> : <ChevronRight />}
</button>
{isExpanded && <div className="border-t border-gray-800 px-3 py-2 space-y-2">...</div>}
```

---

## Layout Patterns

### Dashboard Layout
```
┌─────────────────────────────────────────┐
│  TOPBAR (sticky)                        │
├─────────┬───────────────────────────────┤
│SIDEBAR  │                               │
│         │     MAIN CONTENT              │
│ (NAV)   │     max-w-7xl mx-auto         │
│         │     p-4 lg:p-6                │
│         │                               │
│─────    │                               │
│ Status  │                               │
│ Footer  │                               │
└─────────┴───────────────────────────────┘
```

### Stat Cards Grid
```
grid grid-cols-2 gap-3 (mobile)
grid grid-cols-4 (desktop)
```
- Icon left, label/value stacked
- Sub-value (optional) for thresholds/targets

### Two-Column Layout
```
grid grid-cols-3 gap-4
card.span-2 │ card (side info)
```

### Source Lists
```
max-h-[400px] overflow-y-auto
space-y-2 (between cards)
```

---

## Iconography

### Navigation Icons (Lucide)
```
FlaskConical - Simulation Lab
Settings - Strategy Hub
Key - Credentials
ScanSearch - Market Triage
BookOpen - Research Ledger
FileText - Prompt Studio
Activity - System Health
Database - Vector DB
Network - System Map
Clock - Timestamp
```

### Status Icons
```
Loader2 (animate-spin) - Loading/running
CheckCircle2 - Completed/pass
XCircle - Failed/stopped
Clock - Pending/waiting
AlertTriangle - Warning/contradiction
Radio - Live/processing
ArrowRight - Toggle expand
ChevronDown/ChevronRight - Expand/Collapse
```

### Role Icons
```
Scale - Judge (legal/scales)
TrendingUp - Bull (green, up)
TrendingUp rotate-180 - Bear (red, down)
Flame - Contradiction/pipeline
Brain - AI/DeerFlow
MessageSquare - Reddit
Twitter - X/Twitter
Globe - Web/search
```

---

## Animation & Motion

### State Indicators
```css
/* Live processing */
animate-pulse;

/* Loading/running */
<Loader2 className="animate-spin text-violet-400" />
-Radio animp;

/* Page transitions */
transition-transform duration-200 ease-in-out (sidebar slide)
transition-colors duration-150 (nav hover)
```

### Pulsing Indicators
```tsx
<div className="relative">
  <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
  <div className="relative p-2 rounded-full bg-emerald-500/20">
    <Radio className="h-5 w-5 text-emerald-400 animate-pulse" />
  </div>
</div>
```

---

## Data Visualization Patterns

### Market Metrics Display
```
Label: text-[11px] text-gray-500
Value: text-sm font-bold text-gray-200
Trend: Color-coded (emerald ascending, red descending)
```

### Probability Display
```
Implied Probability: text-white
Judge Probability: text-cyan-400 (to differentiate)
Edge: text-emerald-400 (positive) / text-red-400 (negative)
```

### Pipeline Timeline
- Numbered stages (1, 2, 3...)
- ServiceName + Provider + Model as metadata
- Duration with timing
- Status badge (color-coded)
- Flexible height container for stage details

### Agent Outputs
- Role badge left-aligned
- Model/provider metadata inline
- Expand/collapse raw output
- JSON preview with syntax-style coloring

---

## Responsive Breakpoints

### Tailwind Breakpoints (default)
```
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
```

### Key Responsive Patterns
```css
/* Layout */
flex-col lg:flex-row
hidden md:flex
lg:hidden (mobile-only)

/* Grid */
grid grid-cols-2 lg:grid-cols-4
grid grid-cols-2 gap-4 (desktop 3-column only)

/* Table */
max-w-xs (title truncation)
truncate (long text)
max-h-[600px] overflow-y-auto (scrollable tables)
*/

/* Sidebar */
/* Mobile: Fixed overlay with backdrop blur */
/* Desktop: Sticky sidebar with border-r */
```

---

## Special Patterns

### Live Processing Card
When active agents are running, show: ```border-emerald-500/30 bg-emerald-950/10``` with Radio animate-pulse icon

### Debate/Contradiction Section
- Highlighted with amber border: ```border-amber-500/30```
- Flame icon and distinctive styling
- Grouped Bull+Bear+Judge cards with border colors

### Risk Check Display
- Check/Pass: Green CheckCircle2 + green right column
- X/Fail: Red XCircle + red right column with threshold comparison

### Decision Cards
- BID: < emerald border/background
- WATCH: < amber border/background
- SKIP: < red border/background

### Inline Detail Panels
- Show/hide with row expansion
- Full width within table cell
- Border-top separator
- Space-y-4 between sections

---

## Accessibility

### Color Contrast
- All text uses white/gray scale on dark backgrounds
- Semantic colors (emerald, amber, red) are decorative, not sole indicators
- Tooltips on interactive elements (TooltipProvider required)

### Interaction States
```css
hover:text-white hover:bg-gray-800 (nav items)
hover:text-emerald-300 (active nav)
cursor-pointer (table rows clickable)
```

### Focus States
- Default focus ring from shadcn/ui
- Keyboard navigation preserved

---

## Implementation Notes

### Required Shadcn Components
```
Button
Card (Card, CardContent, CardHeader, CardTitle, CardDescription)
Badge
Input
Select (SelectTrigger, SelectContent, SelectItem, SelectValue)
Table (Table, TableBody, TableCell, TableHead, TableHeader, TableRow)
ScrollArea
Separator
Tooltip (TooltipProvider, TooltipTrigger, TooltipContent)
Dialog (for modals if needed)
switch
slider
```

### CSS Utilities
- `cn()` from `@/lib/utils` for conditional classes
- `lucide-react` for all icons
- Tailwind classes only - no custom CSS files

### Z-Index Layering
```
z-50 - Top bar (sticky header)
z-40 - Mobile backdrop
z-40 - Sidebar (mobile positioning)
z-10 - Desktop sidebar
```

---

## Examples

### Stat Card
```tsx
<div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
  <p className="text-[11px] text-gray-500"><DollarSign className="mr-1 inline h-3 w-3" />Liquidity</p>
  <p className="mt-1 text-sm font-bold text-gray-200">$2.4K</p>
</div>
```

### Stage Timeline Row
```tsx
<div className="flex items-center gap-4 p-3 rounded border border-gray-800 bg-gray-800">
  <div className="text-sm text-gray-500 w-6">1</div>
  <div className="flex-1">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="font-medium">TRIAGE</span>
        <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400">completed</Badge>
      </div>
      <span className="text-xs text-gray-400">1.2s</span>
    </div>
    <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-600">
      <span>Svc: triage-agent</span>
      <span>Prov: OpenAI</span>
      <span>Model: gpt-4o</span>
    </div>
  </div>
</div>
```

### Source Card
```tsx
<div className="p-3 bg-gray-800 rounded border border-gray-700">
  <a href={url} className="text-sm font-medium text-cyan-400 hover:underline flex items-center gap-1">
    {title} <ExternalLink className="h-3 w-3" />
  </a>
  <p className="text-xs text-gray-400 mt-1 line-clamp-2">{snippet}</p>
  <div className="flex items-center gap-2 mt-2">
    <Badge variant="outline" className="text-[10px]">Provider</Badge>
    <span className="text-[10px] text-gray-500">Source info</span>
  </div>
</div>
```

---

## Directory Structure for Components

```
src/components/
├── ui/                    # shadcn/ui components
├── trading/
│   ├── SimulationLab.tsx
│   ├── StrategyHub.tsx
│   ├── CredentialManager.tsx
│   ├── MarketTriage.tsx     # Inline detail pattern
│   ├── ResearchLedger.tsx
│   ├── PromptStudio.tsx
│   ├── LiveStatus.tsx
│   ├── SystemHealth.tsx
│   ├── PipelineSettings.tsx
│   ├── VectorDB.tsx
│   └── SystemMap.tsx
└── ...
```

---

## Environment Context

### Required Environment Variables
```
DATABASE_URL=file:./db/custom.db   # SQLite path
PORT=3000                          # Production server port
```

### Optional Docker Services
- Qdrant (vector DB): port 6333
- Ollama (local LLM): port 11434
- SearXNG (search): port 8888
- Mem0 (memory): port 8000
