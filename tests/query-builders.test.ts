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

  // FalkorDB's newer procedures take ONE configuration map, not positional
  // args, and their YIELD columns are componentId / communityId — not setId /
  // community. The procedure for CDLP is registered as algo.labelPropagation.
  // If any of this drifts, the live analysis panel silently returns nothing.
  test("wcc: config map + componentId", () => {
    expect(buildAlgorithmCall("wcc", "Service", "DEPENDS_ON")).toBe(
      "CALL algo.WCC({nodeLabels: ['Service'], relationshipTypes: ['DEPENDS_ON']}) YIELD node, componentId RETURN node, componentId ORDER BY componentId LIMIT 50",
    );
    expect(buildAlgorithmCall("wcc")).toBe(
      "CALL algo.WCC(null) YIELD node, componentId RETURN node, componentId ORDER BY componentId LIMIT 50",
    );
  });

  test("cdlp: registered as algo.labelPropagation + communityId", () => {
    expect(buildAlgorithmCall("cdlp", "Service", "DEPENDS_ON")).toBe(
      "CALL algo.labelPropagation({nodeLabels: ['Service'], relationshipTypes: ['DEPENDS_ON']}) YIELD node, communityId RETURN node, communityId ORDER BY communityId LIMIT 50",
    );
    expect(buildAlgorithmCall("cdlp")).toBe(
      "CALL algo.labelPropagation() YIELD node, communityId RETURN node, communityId ORDER BY communityId LIMIT 50",
    );
  });

  test("betweenness: algo.betweenness + config map", () => {
    expect(buildAlgorithmCall("betweennessCentrality", "Service", "DEPENDS_ON")).toBe(
      "CALL algo.betweenness({nodeLabels: ['Service'], relationshipTypes: ['DEPENDS_ON']}) YIELD node, score RETURN node, score ORDER BY score DESC LIMIT 25",
    );
    expect(buildAlgorithmCall("betweennessCentrality")).toBe(
      "CALL algo.betweenness({}) YIELD node, score RETURN node, score ORDER BY score DESC LIMIT 25",
    );
  });

  test("no phantom procedure names or YIELD columns", () => {
    for (const algo of ["pageRank", "wcc", "cdlp", "betweennessCentrality"] as const) {
      const cypher = buildAlgorithmCall(algo, "Service", "DEPENDS_ON");
      expect(cypher).not.toContain("algo.CDLP");
      expect(cypher).not.toContain("algo.betweennessCentrality");
      expect(cypher).not.toContain("setId");
      expect(cypher).not.toContain("YIELD node, community ");
    }
  });
});