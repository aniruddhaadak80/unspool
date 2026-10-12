/**
 * Read-only guard tests. The Cypher console is public on the live deploy, so
 * this gate is the difference between a demo and a way to delete a demo graph.
 */
import { describe, expect, test } from "bun:test";
import {
  containsWriteClause,
  isReadOnlyCypher,
  isSingleStatement,
  statements,
  toExecutable,
} from "../src/lib/graph/readonly";

describe("statements / isSingleStatement", () => {
  test("one statement, with or without a trailing semicolon", () => {
    expect(statements("MATCH (n) RETURN n")).toHaveLength(1);
    expect(statements("MATCH (n) RETURN n;")).toHaveLength(1);
    expect(isSingleStatement("MATCH (n) RETURN n;")).toBe(true);
  });

  test("two statements are detected", () => {
    expect(statements("MATCH (n) RETURN n; CREATE (x)")).toHaveLength(2);
    expect(isSingleStatement("MATCH (n) RETURN n; CREATE (x)")).toBe(false);
  });
});

describe("containsWriteClause", () => {
  test("flags every mutating clause", () => {
    for (const c of [
      "CREATE (n:Evil)",
      "MATCH (n) MERGE (n)-[:X]->(m)",
      "MATCH (n) SET n.x = 1",
      "MATCH (n) DELETE n",
      "MATCH (n) DETACH DELETE n",
      "MATCH (n) REMOVE n.x",
      "DROP INDEX ON :Service(name)",
      "FOREACH (x IN [1,2] | CREATE (:N))",
      "CALL { MATCH (n) CREATE (m) } RETURN 1",
      "query GRAPH.QUERY mygraph 'anything'",
    ]) {
      expect(containsWriteClause(c), c).toBe(true);
    }
  });

  test("allows reads, including algo.* and aggregate CALL", () => {
    for (const c of [
      "MATCH (n:Service) RETURN n LIMIT 10",
      "CALL algo.pageRank('Service','DEPENDS_ON') YIELD node, score RETURN node, score",
      "MATCH p = (a)-[:DEPENDS_ON*1..3]->(b) RETURN [n IN nodes(p) | n.name]",
      "CALL db.labels()",
      "MATCH (n) WHERE n.name CONTAINS 'create' RETURN n",
    ]) {
      expect(containsWriteClause(c), c).toBe(false);
    }
  });

  test("a keyword hidden in a comment does not false-positive", () => {
    expect(containsWriteClause("// CREATE something later\nMATCH (n) RETURN n")).toBe(false);
    expect(containsWriteClause("/* MERGE plan */ MATCH (n) RETURN n")).toBe(false);
  });

  test("a keyword inside a string literal does not false-positive", () => {
    expect(containsWriteClause("MATCH (n) WHERE n.name CONTAINS 'create' RETURN n")).toBe(false);
    expect(containsWriteClause('MATCH (n) WHERE n.title = "drop table" RETURN n')).toBe(false);
  });

  test("a real write alongside a string is still caught", () => {
    expect(containsWriteClause("MATCH (n) SET n.x = 'CREATE' RETURN n")).toBe(true);
  });
});

describe("isReadOnlyCypher (the full gate)", () => {
  test("rejects trailing-statement smuggling", () => {
    expect(isReadOnlyCypher("MATCH (n) RETURN n; CREATE (x:Evil)")).toBe(false);
  });

  test("rejects a direct write", () => {
    expect(isReadOnlyCypher("CREATE (n:Evil)")).toBe(false);
  });

  test("accepts a plain read (trailing semicolon ok)", () => {
    expect(isReadOnlyCypher("MATCH (n) RETURN n LIMIT 5")).toBe(true);
    expect(isReadOnlyCypher("MATCH (n) RETURN n LIMIT 5;")).toBe(true);
  });
});

describe("toExecutable", () => {
  test("trims a single trailing semicolon and whitespace", () => {
    expect(toExecutable("MATCH (n) RETURN n;\n")).toBe("MATCH (n) RETURN n");
    expect(toExecutable("  MATCH (n) RETURN n  ")).toBe("MATCH (n) RETURN n");
  });
});
