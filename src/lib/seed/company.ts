/**
 * Synthetic, fully-invented company used for the demo graph. No real data —
 * satisfies the rule "use data you are allowed to use."
 *
 * The scenario seeded so the agent has something meaty to reason about:
 *   A payments outage where the true root cause is a schema migration in the
 *   ledger service that cascaded through the risk engine and checkout API —
 *   discoverable only by following DEPENDS_ON hops and reading the ADR chain.
 */

export interface SeedService {
  name: string;
  tier: 1 | 2 | 3;
  language: string;
  repo: string;
  team: string;
  cluster: string;
}
export const SERVICES: SeedService[] = [
  { name: "checkout-api", tier: 1, language: "TypeScript", repo: "acme/checkout", team: "payments", cluster: "prod-us-east" },
  { name: "payments-gateway", tier: 1, language: "Go", repo: "acme/pay-gateway", team: "payments", cluster: "prod-us-east" },
  { name: "risk-engine", tier: 1, language: "Python", repo: "acme/risk", team: "risk", cluster: "prod-us-east" },
  { name: "ledger", tier: 1, language: "Java", repo: "acme/ledger", team: "payments", cluster: "prod-us-east" },
  { name: "fraud-scorer", tier: 2, language: "Python", repo: "acme/fraud", team: "risk", cluster: "prod-us-east" },
  { name: "notify-worker", tier: 2, language: "TypeScript", repo: "acme/notify", team: "growth", cluster: "prod-us-west" },
  { name: "user-profile", tier: 2, language: "Go", repo: "acme/profile", team: "identity", cluster: "prod-us-east" },
  { name: "inventory-svc", tier: 2, language: "Rust", repo: "acme/inventory", team: "commerce", cluster: "prod-eu-west" },
  { name: "search-index", tier: 2, language: "Python", repo: "acme/search", team: "discovery", cluster: "prod-us-west" },
  { name: "recommendations", tier: 3, language: "Python", repo: "acme/recs", team: "discovery", cluster: "prod-us-west" },
  { name: "analytics-etl", tier: 3, language: "Python", repo: "acme/etl", team: "data", cluster: "prod-us-central" },
  { name: "feature-flags", tier: 2, language: "Go", repo: "acme/flags", team: "platform", cluster: "prod-us-east" },
];

/** Directed dependency edges: source depends on target. */
export const DEPENDS_ON: Array<[string, string, number, boolean]> = [
  ["checkout-api", "payments-gateway", 40, true],
  ["checkout-api", "inventory-svc", 30, false],
  ["checkout-api", "user-profile", 20, false],
  ["checkout-api", "feature-flags", 5, true],
  ["payments-gateway", "risk-engine", 60, true],
  ["payments-gateway", "ledger", 25, true],
  ["risk-engine", "fraud-scorer", 45, true],
  ["risk-engine", "user-profile", 15, false],
  ["ledger", "analytics-etl", 0, false],
  ["notify-worker", "user-profile", 10, false],
  ["notify-worker", "feature-flags", 5, false],
  ["search-index", "analytics-etl", 0, false],
  ["recommendations", "search-index", 0, false],
  ["recommendations", "analytics-etl", 0, false],
  ["fraud-scorer", "user-profile", 10, false],
];

export interface SeedTeam {
  name: string;
  members: Array<{ name: string; role: string; timezone: string }>;
}
export const TEAMS: SeedTeam[] = [
  {
    name: "payments",
    members: [
      { name: "Priya Nair", role: "staff-engineer", timezone: "IST" },
      { name: "Marcus Feld", role: "engineering-manager", timezone: "EST" },
      { name: "Dana Okoye", role: "sre", timezone: "GMT" },
    ],
  },
  {
    name: "risk",
    members: [
      { name: "Kenji Watanabe", role: "ml-engineer", timezone: "JST" },
      { name: "Sofia Reyes", role: "engineering-manager", timezone: "CET" },
    ],
  },
  { name: "platform", members: [{ name: "Alex Duarte", role: "sre", timezone: "BRT" }] },
  { name: "identity", members: [{ name: "Lena Kovac", role: "engineer", timezone: "CET" }] },
  { name: "commerce", members: [{ name: "Tomas Berg", role: "engineer", timezone: "EST" }] },
  { name: "discovery", members: [{ name: "Amara Diallo", role: "ml-engineer", timezone: "GMT" }] },
  { name: "growth", members: [{ name: "Ivy Chen", role: "engineer", timezone: "PST" }] },
  { name: "data", members: [{ name: "Ravi Menon", role: "data-engineer", timezone: "IST" }] },
];

/** on-call rosters: service → person on call. */
export const ONCALL: Array<[string, string]> = [
  ["ledger", "Priya Nair"],
  ["payments-gateway", "Priya Nair"],
  ["checkout-api", "Dana Okoye"],
  ["risk-engine", "Kenji Watanabe"],
  ["fraud-scorer", "Kenji Watanabe"],
  ["feature-flags", "Alex Duarte"],
];

export interface SeedDoc {
  id: string;
  kind: "runbook" | "adr" | "slack" | "ticket" | "postmortem";
  title: string;
  body: string;
  at: string;
  refs: string[];
}
export const DOCUMENTS: SeedDoc[] = [
  {
    id: "rb-ledger",
    kind: "runbook",
    title: "Ledger slow-query rollback",
    body: "If p99 on ledger writes exceeds 250ms after a migration, first check for sequential scans on journal_entry. The safe rollback is to re-enable the composite index idx_journal_account_time before reverting the migration, because a plain revert drops the index and re-scans on restart.",
    at: "2026-06-02T10:00:00Z",
    refs: ["ledger"],
  },
  {
    id: "adr-42",
    kind: "adr",
    title: "ADR-42: drop composite index on journal_entry",
    body: "We drop idx_journal_account_time to speed up the new ingestion path. Accepted 2026-09-20 by Marcus Feld. Known risk: rollback of the migration alone will NOT restore the index, so the ledger p99 alert needs a manual index re-create. Owner: payments.",
    at: "2026-09-20T14:30:00Z",
    refs: ["ledger"],
  },
  {
    id: "pm-118",
    kind: "postmortem",
    title: "PM-118: June ledger latency spike",
    body: "Root cause was the same composite-index removal. Cascade: ledger -> risk-engine -> payments-gateway. Mitigated by re-creating idx_journal_account_time. Action item: encode the index in the migration, not the runbook.",
    at: "2026-06-05T09:00:00Z",
    refs: ["ledger", "risk-engine", "payments-gateway"],
  },
  {
    id: "slack-payments-1",
    kind: "slack",
    title: "#payments — migration note",
    body: "Ledger migration 2026.10.09 ships tonight, it's the ADR-42 follow-up. Should be a no-op for reads.",
    at: "2026-10-09T18:00:00Z",
    refs: ["ledger"],
  },
  {
    id: "rb-checkout",
    kind: "runbook",
    title: "Checkout error-rate triage",
    body: "Checkout 5xx almost always traces to payments-gateway. Check feature-flags first if errors are 100% on one variant, otherwise walk the dependency graph one hop at a time and look for a tier-1 service with a fresh deploy.",
    at: "2026-05-01T10:00:00Z",
    refs: ["checkout-api", "payments-gateway", "feature-flags"],
  },
  {
    id: "ticket-903",
    kind: "ticket",
    title: "PROD-903: elevated checkout errors",
    body: "Checkout 5xx at 4.2%. Started 6 min after ledger migration. No config change on checkout-api.",
    at: "2026-10-10T09:14:00Z",
    refs: ["checkout-api", "ledger"],
  },
];

export interface SeedIncident {
  id: string;
  title: string;
  severity: 1 | 2 | 3;
  status: "resolved" | "open";
  openedAt: string;
  affects: string[];
}
export const INCIDENTS: SeedIncident[] = [
  {
    id: "INC-2041",
    title: "Elevated checkout 5xx after ledger migration",
    severity: 1,
    status: "open",
    openedAt: "2026-10-10T09:14:00Z",
    affects: ["checkout-api", "payments-gateway", "ledger", "risk-engine"],
  },
  {
    id: "INC-1180",
    title: "June ledger latency spike",
    severity: 2,
    status: "resolved",
    openedAt: "2026-06-04T11:20:00Z",
    affects: ["ledger", "risk-engine"],
  },
];

export const ALERTS: Array<{ name: string; threshold: string; window: string }> = [
  { name: "checkout-5xx-rate", threshold: "> 1%", window: "5m" },
  { name: "ledger-write-p99", threshold: "> 250ms", window: "10m" },
  { name: "risk-engine-timeout", threshold: "> 20", window: "5m" },
];

/** Static semantic memory the org "already knows" — seeded as Memory nodes. */
export const SEMANTIC_MEMORY: Array<{ key: string; value: string; about: string }> = [
  { key: "ledger-criticality", value: "ledger is tier-1; every payment path depends on it", about: "ledger" },
  { key: "adr-42-risk", value: "ADR-42 removed a composite index; rollback needs a manual re-create", about: "ledger" },
  { key: "payments-oncall", value: "Priya Nair is the primary on-call for ledger and payments-gateway", about: "payments" },
  { key: "cascade-pattern", value: "ledger problems cascade to risk-engine then payments-gateway then checkout-api", about: "payments" },
];

export const PROCEDURAL_MEMORY: Array<{ key: string; value: string; about: string }> = [
  { key: "runbook-ledger-rollback", value: "Re-create idx_journal_account_time BEFORE reverting the ledger migration; a plain revert drops the index again.", about: "ledger" },
  { key: "triage-order", value: "For checkout 5xx: check feature-flags variant split, then walk DEPENDS_ON hops to the nearest tier-1 service with a deploy in the last hour.", about: "checkout-api" },
];
