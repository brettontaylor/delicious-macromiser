# Macromiser — Technical Architecture

## 1. Binding constraints

These are not preferences. They follow from how Claude reaches an MCP server.

| Constraint | Implication |
|---|---|
| Claude chat only connects to **remote** MCP servers | No stdio, no localhost, no `claude_desktop_config.json` |
| Claude connects from **Anthropic's cloud**, not the user's machine | Server must be publicly reachable over HTTPS. VPN/firewalled hosts fail |
| Trusted TLS required | No self-signed certs |
| Transport: Streamable HTTP or SSE | **Build Streamable HTTP only.** SSE is slated for deprecation |
| Auth: authless or OAuth 2.1 + DCR | Authless is supported and legal — take it for v1 |
| Mobile clients can *use* but not *add* connectors | Add the connector once on claude.ai web; iOS/Android inherit it |
| Custom connectors need Pro/Max/Team/Enterprise | Free tier is limited to one custom connector |

## 2. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Cloudflare Workers** | Free tier, no cold-start ops, HTTPS by default, first-class remote-MCP support incl. OAuth libraries |
| Database | **Cloudflare D1** (SQLite) | Same platform, zero ops, plain SQL |
| Protocol | Official MCP TypeScript SDK | Pin to the SDK's *current* server example |
| Transport | Streamable HTTP, `POST /mcp` | Dedicated route; separate `GET /health` |
| Web UI | Same Worker, `/app` | React or plain HTML — correction UI, not entry UI |
| Auth v1 | Authless, unguessable path | `/mcp/<32-char-random>` |
| Auth v2 | OAuth 2.1 + PKCE + DCR | Cloudflare's `workers-oauth-provider`, or Auth0/WorkOS |

**Alternative stack** if you want Postgres and real auth from day one:
Bun + Hono + Supabase, deployed to Railway or Fly. Supabase gives you email auth
and Row Level Security for free, which does most of Phase 4's work up front.

**Decision rule:** if this stays a personal tool → Workers + D1. If you're
reasonably sure a second user is coming → Supabase.

## 3. Component layout

```
┌──────────────────────────────┐
│  Claude (web / mobile / Code)│
└──────────────┬───────────────┘
               │ Streamable HTTP (MCP)
               ▼
┌──────────────────────────────┐
│  Cloudflare Worker           │
│  ├─ /mcp     MCP tool surface│  ← dumb: storage + arithmetic only
│  ├─ /app     correction UI   │
│  ├─ /export  CSV / JSON      │
│  └─ /health                  │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│  D1 (SQLite)                 │
└──────────────────────────────┘

  Coaching rules live OUTSIDE this box, in a Claude Skill.
```

## 4. Data model

```sql
-- ---------- identity ----------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  tz            TEXT NOT NULL DEFAULT 'America/New_York',
  units         TEXT NOT NULL DEFAULT 'imperial',
  created_at    TEXT NOT NULL
);

-- ---------- nutrition ----------
CREATE TABLE meals (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  logged_at     TEXT NOT NULL,          -- ISO8601 UTC
  local_date    TEXT NOT NULL,          -- YYYY-MM-DD in user tz; the grouping key
  meal_type     TEXT,                   -- breakfast|lunch|dinner|snack
  description   TEXT NOT NULL,          -- verbatim user text
  kcal          REAL NOT NULL,
  protein_g     REAL NOT NULL,
  fat_g         REAL NOT NULL,
  carb_g        REAL NOT NULL,
  fiber_g       REAL,
  alcohol_g     REAL NOT NULL DEFAULT 0,  -- pure ethanol; NOT folded into carbs
  confidence    TEXT NOT NULL,            -- high|medium|low
  source        TEXT NOT NULL,            -- estimate|corrected|barcode|import
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_meals_user_date ON meals(user_id, local_date);

-- ---------- training ----------
CREATE TABLE workouts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  local_date    TEXT NOT NULL,
  session_label TEXT,                   -- 'Day A', 'Pull', free text
  notes         TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE sets (
  id            TEXT PRIMARY KEY,
  workout_id    TEXT NOT NULL REFERENCES workouts(id),
  exercise      TEXT NOT NULL,          -- normalized slug: 'back_squat'
  exercise_raw  TEXT,                   -- as the user said it
  set_no        INTEGER NOT NULL,
  reps          INTEGER,
  weight_lb     REAL,
  rpe           REAL,
  completed     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_sets_exercise ON sets(exercise);

-- ---------- body + goals ----------
CREATE TABLE bodyweight (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  local_date    TEXT NOT NULL,
  weight_lb     REAL,
  waist_in      REAL,
  UNIQUE(user_id, local_date)
);

CREATE TABLE goals (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  effective_from TEXT NOT NULL,          -- goals are versioned, never overwritten
  kcal           REAL,
  protein_g      REAL,
  fat_g          REAL,
  carb_g         REAL,
  target_weight_lb REAL,
  weekly_sessions  INTEGER
);

-- ---------- the correction flywheel ----------
CREATE TABLE portion_memory (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  phrase        TEXT NOT NULL,          -- 'my usual chicken portion'
  kcal          REAL, protein_g REAL, fat_g REAL, carb_g REAL,
  times_used    INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL,
  UNIQUE(user_id, phrase)
);
```

### Three schema decisions worth defending

**`alcohol_g` as its own column.** Folding ethanol into carbs is what every
mainstream tracker does and it destroys the single most actionable signal for
anyone who drinks: *food calories excluding alcohol*. A 2,100-calorie day where
520 came from wine is a 1,580-calorie food day — a very different day, especially
after a heavy training session.

**`source` + `confidence` on every meal.** Estimated and corrected data are
different data. Keeping them distinguishable is what makes the correction UI
worth building and what makes `portion_memory` possible.

**`local_date` denormalized.** Every meaningful query is "what did I do on this
calendar day in my timezone." Computing that from a UTC timestamp at query time
across DST boundaries is a recurring bug factory. Store it once, on write.

## 5. MCP tool surface

Ten tools. Descriptions matter more than the code — that's what the model reads.

### Write

| Tool | Args | Notes |
|---|---|---|
| `log_meal` | description, kcal, macros, alcohol_g?, meal_type?, confidence, when? | Client estimates macros; server stores. Returns updated day total |
| `log_workout` | session_label?, sets[]: {exercise, set_no, reps, weight_lb, rpe?}, notes? | One call per session, not per set |
| `log_bodyweight` | weight_lb?, waist_in?, date? | Upsert on (user, date) |
| `set_goals` | kcal, macros, target_weight_lb?, weekly_sessions? | Inserts a new versioned row |
| `update_entry` | entry_type, id, patch | Sets `source='corrected'` |
| `delete_entry` | entry_type, id | Soft delete |

### Read

| Tool | Returns | Why it matters |
|---|---|---|
| `get_today` | Meals so far, totals, **remaining vs. goals**, food-kcal-excluding-alcohol | Answers "where am I?" in one call |
| `get_last_performance` | For exercise(s): last date, sets, reps, weight, RPE, plus the prior 3 sessions | **The differentiating tool.** Enables real progression |
| `get_week_summary` | 7-day averages: kcal, protein, adherence %, sessions, bodyweight trend | The only honest progress view |
| `get_history` | Date-ranged meals/workouts/weight | Analysis, export, "how was last month" |

### Tool-description guidance

The model's behavior is driven almost entirely by these strings. Write them to
answer *when to call this*, not *what it does*:

> `get_last_performance` — **Call this before recommending any weight for any
> exercise.** Returns the most recent completed sets for the given exercise(s),
> including reps, load and RPE, plus the three prior sessions so progression can
> be judged. Never guess a working weight without calling this first.

### Deliberately absent

No `recommend_workout`. No `analyze_progress`. No `suggest_meal`. The moment the
server returns advice, coaching logic is trapped behind a deploy cycle. Keep it
in the Skill.

## 6. Auth

### v1 — authless

Serve MCP at `/mcp/<32 random chars>`. Treat the URL as the credential.

- Honest label: **security by obscurity.** Fine for your own macro log.
- Do **not** accept a `user_id` from the client. Derive identity from the path
  server-side. Never trust identity supplied by the model.
- Never put credentials in a query string — the MCP spec prohibits access tokens
  in the URI query, and query strings leak into logs and proxies.

### v2 — OAuth 2.1

Required the moment a second person uses this.

| Requirement | Detail |
|---|---|
| Discovery | `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` |
| Dynamic Client Registration | RFC 7591 — Claude registers itself |
| PKCE | S256 mandatory |
| Redirect URI | `https://claude.ai/api/mcp/auth_callback` for hosted Claude surfaces |
| Claude Code redirect | Loopback on an ephemeral port — match `http://127.0.0.1/callback` port-agnostically |
| Token endpoint | Accept `application/x-www-form-urlencoded` |
| Re-registration | Return HTTP 401 + `invalid_client` from the token endpoint when a DCR client is stale |

Do not hand-roll this. Use Cloudflare's OAuth provider library, or delegate to
Auth0/WorkOS/Supabase and have the Worker validate JWTs.

## 7. Deployment & operations

| Concern | Approach |
|---|---|
| Environments | `macromiser-dev` and `macromiser-prod` Workers; separate D1 instances |
| Secrets | `wrangler secret put` — never in the repo |
| Migrations | Numbered SQL files in `migrations/`, applied via `wrangler d1 migrations apply` |
| Local testing | MCP Inspector against `wrangler dev`; then the real connector in claude.ai |
| Backups | Nightly `wrangler d1 export` to R2. SQLite is small; keep 30 days |
| Observability | Structured logs per tool call: tool name, latency, user, outcome. No meal contents in logs |
| Rate limiting | Per-user cap on writes/minute — cheap insurance against a loop |

## 8. Repo structure

```
macromiser/
├── src/
│   ├── index.ts              # Worker entry, routing
│   ├── mcp/
│   │   ├── server.ts         # MCP server + transport wiring
│   │   ├── tools/            # one file per tool
│   │   └── descriptions.ts   # tool descriptions — treat as product copy
│   ├── db/
│   │   ├── queries.ts
│   │   └── schema.sql
│   ├── domain/
│   │   ├── totals.ts         # day/week aggregation, alcohol separation
│   │   └── progression.ts    # last-performance shaping (data, not advice)
│   ├── auth/                 # v2
│   └── app/                  # correction UI
├── migrations/
├── skill/
│   └── SKILL.md              # the coaching layer — see COACHING-LAYER.md
├── test/
└── wrangler.toml
```

## 9. Known pitfalls

1. **Stale transport tutorials.** MCP transport APIs have changed faster than the
   tool-registration pattern. Copy from the current official SDK example only.
2. **Timezone drift.** Compute `local_date` on write, in the user's tz. Always.
3. **Over-broad tools.** A `query_data(sql)` tool is tempting and is a mistake —
   the model will misuse it and you can't reason about the surface.
4. **Trusting model-supplied identity.** Authorization belongs inside the server
   boundary, always derived from the credential, never from tool arguments.
5. **Silent write failures.** If a log fails, the tool result must say so plainly.
   A dropped meal that the assistant reports as saved is the worst possible bug.
