/**
 * Normalizer tests. The `falkordb` Node client returns client-parsed objects
 * ({id, labels, properties}) — NOT serialized strings. These tests lock the
 * exact shape the whole pipeline (agent, trace UI, canvas) depends on.
 */
import { describe, expect, test } from "bun:test";
import { normalizeEdge, normalizeNode } from "../src/lib/graph/schema";

describe("normalizeNode", () => {
  test("maps a client-parsed node to the UI shape", () => {
    const n = normalizeNode({
      id: 42,
      labels: ["Service"],
      properties: { name: "checkout-api", tier: 1 },
    });
    expect(n).toEqual({
      id: "42",
      label: "checkout-api",
      labels: ["Service"],
      properties: { name: "checkout-api", tier: 1 },
    });
  });

  test("falls back to title/key/id for label, then internal id", () => {
    expect(normalizeNode({ id: 1, labels: ["Document"], properties: { title: "ADR-42" } })?.label).toBe(
      "ADR-42",
    );
    expect(normalizeNode({ id: 2, labels: ["Memory"], properties: { key: "x" } })?.label).toBe("x");
    expect(normalizeNode({ id: 3, labels: ["Tenant"], properties: {} })?.label).toBe("3");
  });

  test("rejects garbage without panicking", () => {
    expect(normalizeNode(null)).toBeNull();
    expect(normalizeNode(undefined)).toBeNull();
    expect(normalizeNode({ id: 1 })).toBeNull(); // no labels array
    expect(normalizeNode("NOPE")).toBeNull();
  });
});

describe("normalizeEdge", () => {
  test("maps a client-parsed relationship to the UI shape", () => {
    const e = normalizeEdge({
      id: 7,
      relationshipType: "DEPENDS_ON",
      sourceId: 1,
      destinationId: 2,
      properties: { critical: true, latencyMs: 40 },
    });
    expect(e).toEqual({
      id: "7",
      type: "DEPENDS_ON",
      source: "1",
      target: "2",
      properties: { critical: true, latencyMs: 40 },
    });
  });

  test("survives missing properties and bigint ids", () => {
    const e = normalizeEdge({
      id: BigInt("9007199254740993"),
      relationshipType: "ONCALL_FOR",
      sourceId: BigInt(12),
      destinationId: BigInt(88),
    });
    expect(e?.id).toBe("9007199254740993");
    expect(e?.source).toBe("12");
    expect(e?.target).toBe("88");
    expect(e?.properties).toEqual({});
  });

  test("rejects non-edges", () => {
    expect(normalizeEdge(null)).toBeNull();
    expect(normalizeEdge({ id: 1 })).toBeNull();
    expect(normalizeEdge({ relationshipType: "" })).not.toBeNull(); // empty type still counts
  });
});