#!/usr/bin/env bun
/**
 * Seed the demo graph into FalkorDB from the CLI.
 *
 *   FALKORDB_URL=falkor://... bun run seed [tenantId]
 *
 * Idempotent — wipes and rebuilds only the named tenant's graph.
 */
import { graphNameFor, normalizeTenantId, selectGraph } from "../src/lib/graph/falkordb";
import { graphStats, seedGraph } from "../src/lib/graph/seed";

const tenant = normalizeTenantId(process.argv[2]);
const graph = await selectGraph(tenant);
const seeded = await seedGraph(graph, tenant);
const stats = await graphStats(graph);
console.log(`Seeded tenant "${tenant}" (graph: ${graphNameFor(tenant)})`);
console.log(`  nodes: ${stats.nodes}  relationships: ${stats.rels}`);
console.log("  labels:", stats.labels.map((l) => `${l.label}(${l.c})`).join(", "));
