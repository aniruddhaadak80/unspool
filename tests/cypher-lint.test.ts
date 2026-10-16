/**
 * Cypher-lint test — the guard against "valid-looking Cypher that FalkorDB
 * rejects".
 *
 * These are the bugs a plain unit test cannot see, because the string is
 * well-formed Cypher; only FalkorDB disagrees:
 *
 *  1. `LIMIT $n` / `SKIP $n` — FalkorDB does NOT accept a query parameter in
 *     LIMIT/SKIP. The bound must be a literal. (Caught three of ours.)
 *  2. Phantom procedure names — CDLP is registered as `algo.labelPropagation`,
 *     not `algo.CDLP`; betweenness as `algo.betweenness`, not
 *     `algo.betweennessCentrality`. A CALL to an unregistered procedure throws
 *     "unknown procedure".
 *  3. Phantom YIELD columns — `algo.WCC` yields `componentId` (not `setId`) and
 *     `algo.labelPropagation` yields `communityId` (not `community`). Yielding
 *     an unknown field is an error.
 *
 * It reads the real source (and the docs, whose queries are a public promise)
 * and needs no database. Verified against https://docs.falkordb.com.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** Every .ts/.tsx file under a directory (recursive). */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const CODE_FILES = [...walk(join(root, "src")), ...walk(join(root, "scripts"))];
const DOC_FILES = [
  join(root, "README.md"),
  ...walk(join(root, "docs")),
].filter((f) => f.endsWith(".md"));

const rel = (f: string) => relative(root, f).replace(/\\/g, "/");

/** A finding is { file, line, text }. */
interface Finding {
  file: string;
  line: number;
  text: string;
}

function scan(files: string[], pattern: RegExp): Finding[] {
  const hits: Finding[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((text, i) => {
      if (pattern.test(text)) hits.push({ file: rel(file), line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

const fmt = (hits: Finding[]) => hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n");

describe("cypher lint — executable code", () => {
  test("no query parameter inside LIMIT / SKIP (FalkorDB forbids it)", () => {
    // `$name` is a Cypher parameter; `${…}` is a JS template interpolation.
    const hits = scan(CODE_FILES, /\b(LIMIT|SKIP)\s+\$[A-Za-z_]/i);
    expect(hits, `parameter used in LIMIT/SKIP:\n${fmt(hits)}`).toEqual([]);
  });

  test("no CALL to a phantom procedure name", () => {
    // Registered procedures (FalkorDB src/procedures/procedure.c). Anything else
    // in a CALL algo.X(...) is a runtime "unknown procedure" error.
    const registered = new Set([
      "pageRank",
      "betweenness",
      "WCC",
      "labelPropagation",
      "BFS",
      "MSF",
      "maxFlow",
      "SPpaths",
      "SSpaths",
      "HarmonicCentrality",
      "dijkstra",
    ]);
    const hits: Finding[] = [];
    for (const file of CODE_FILES) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((text, i) => {
          for (const m of text.matchAll(/algo\.([A-Za-z]+)/g)) {
            const name = m[1];
            const known = [...registered].some((r) => r.toLowerCase() === name.toLowerCase());
            if (!known) hits.push({ file: rel(file), line: i + 1, text: text.trim() });
          }
        });
    }
    expect(hits, `unregistered algo.* procedure:\n${fmt(hits)}`).toEqual([]);
  });

  test("no phantom YIELD columns (setId / bare community)", () => {
    // "community" is fine only as "communityId"; "setId" is never right.
    const hits = [
      ...scan(CODE_FILES, /\bYIELD\b[^\n]*\bsetId\b/i),
      ...scan(CODE_FILES, /\b(?:YIELD|RETURN)\b[^\n]*\bcommunity\b(?!Id)/),
    ];
    expect(hits, `phantom YIELD column:\n${fmt(hits)}`).toEqual([]);
  });
});

describe("cypher lint — documentation snippets", () => {
  test("docs never show CALL algo.CDLP / algo.betweennessCentrality", () => {
    const hits = [...scan(DOC_FILES, /CALL\s+algo\.CDLP/i), ...scan(DOC_FILES, /CALL\s+algo\.betweennessCentrality/i)];
    expect(hits, `phantom procedure in docs:\n${fmt(hits)}`).toEqual([]);
  });

  test("docs never show YIELD node, setId / RETURN node, community", () => {
    const hits = [
      ...scan(DOC_FILES, /YIELD\s+node,\s*setId/i),
      ...scan(DOC_FILES, /RETURN\s+node,\s*community\b(?!Id)/i),
    ];
    expect(hits, `phantom column in docs:\n${fmt(hits)}`).toEqual([]);
  });

  test("docs never show a parameter inside LIMIT", () => {
    const hits = scan(DOC_FILES, /\bLIMIT\s+\$[A-Za-z_]/i);
    expect(hits, `parameterized LIMIT in docs:\n${fmt(hits)}`).toEqual([]);
  });
});
