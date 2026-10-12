/**
 * Cypher-builder tests. The agent and the analysis panel both build algorithm
 * calls through buildAlgorithmCall — quote escaping and NULL defaults are
 * locked here so a future edit can't emit invalid FalkorDB.
 */
import { describe, expect, test } from "bun:test";
import { buildAlgorithmCall } from "../src/lib/graph/queries";

describe("buildAlgorithmCall", () => {
  test("pageRank with label + rel type", () => {
    expect(buildAlgorithmCall("pageRank", "Service", "DEPENDS_ON")).toBe(
      "CALL algo.pageRank('Service', 'DEPENDS_ON') YIELD node, score RETURN node, score ORDER BY score DESC LIMIT 25",
    );
  });

  test("NULL label/rel when omitted (whole-graph run)", () => {
    expect(buildAlgorithmCall("pageRank")).toBe(
      "CALL algo.pageRank(NULL, NULL) YIELD node, score RETURN node, score ORDER BY score DESC LIMIT 25",
    );
  });

  test("escapes single quotes inside labels", () => {
    expect(buildAlgorithmCall("pageRank", "O'Reilly", "IS'")).toBe(
      "CALL algo.pageRank('O\\'Reilly', 'IS\\'') YIELD node, score RETURN node, score ORDER BY score DESC LIMIT 25",
    );
  });

  test("wcc / cdlp / betweenness map to the right procedures", () => {
    expect(buildAlgorithmCall("wcc", "Service", "DEPENDS_ON")).toContain("CALL algo.WCC(");
    expect(buildAlgorithmCall("wcc", "Service", "DEPENDS_ON")).toContain("RETURN node, setId");
    expect(buildAlgorithmCall("cdlp", "Service", "DEPENDS_ON")).toContain("CALL algo.CDLP(");
    expect(buildAlgorithmCall("cdlp", "Service", "DEPENDS_ON")).toContain("RETURN node, community");
    expect(buildAlgorithmCall("betweennessCentrality", "Service", "DEPENDS_ON")).toContain(
      "CALL algo.betweennessCentrality(",
    );
  });
});