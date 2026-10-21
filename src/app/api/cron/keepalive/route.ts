import { NextRequest, NextResponse } from "next/server";
import { isFalkorConfigured, normalizeTenantId, selectGraph } from "@/lib/graph/falkordb";
import { graphStats, seedGraph } from "@/lib/graph/seed";

export const maxDuration = 60;

/**
 * GET /api/cron/keepalive — keeps the FalkorDB Cloud *free* tier alive and
 * self-heals the demo.
 *
 * FalkorDB Free instances that go unused for 1 day are stopped, and deleted
 * after 7 days (no backups). Judging can happen days after the demo was
 * recorded, so a cold graph would ship a broken link. This endpoint is hit on a
 * schedule (Vercel Cron + a GitHub Actions backup) and:
 *
 *  1. touches FalkorDB with a real query — that counts as utilization, so the
 *     instance is never stopped for inactivity; and
 *  2. if a tenant's graph was lost/emptied, re-seeds it from the synthetic
 *     company so the live demo is never a blank canvas.
 *
 * When CRON_SECRET is set, Vercel sends `Authorization: Bearer $CRON_SECRET`.
 */
const TENANTS = (process.env.KEEPALIVE_TENANTS ?? "demo,acme,acme-staging")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean)
  .map((t) => normalizeTenantId(t));

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  if (!isFalkorConfigured()) {
    return NextResponse.json(
      { error: "FalkorDB not configured.", hint: "Set FALKORDB_URL." },
      { status: 503 },
    );
  }

  const tenants: Array<{ tenant: string; nodes: number; reseeded: boolean }> = [];
  try {
    for (const tenant of TENANTS) {
      const graph = await selectGraph(tenant);
      let stats = await graphStats(graph);
      let reseeded = false;
      if (stats.nodes === 0) {
        await seedGraph(graph, tenant);
        stats = await graphStats(graph);
        reseeded = true;
      }
      tenants.push({ tenant, nodes: stats.nodes, reseeded });
    }
    return NextResponse.json({ ok: true, at: Date.now(), tenants });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
