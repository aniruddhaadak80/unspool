"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import type { CanvasNode, CanvasEdge } from "@/lib/client/types";

/**
 * The live company graph, rendered with React Flow. Two jobs:
 *   1. Show the topology an incident responder cares about (services, teams,
 *      people, docs, incidents, memory) colored by label.
 *   2. During replay, light up exactly the nodes + edges the agent touched on
 *      each step — so you watch the reasoning travel the graph.
 *
 * Layout is deterministic (layered by BFS depth from the seed) so the canvas
 * doesn't jitter between renders and the "shape" of the reasoning is legible.
 */

const LABEL_COLOR: Record<string, string> = {
  Service: "#ff8101",
  Team: "#a371f7",
  Person: "#58a6ff",
  Document: "#3fb950",
  Incident: "#f85149",
  Memory: "#d29922",
  Alert: "#ff7b72",
  Action: "#f0883e",
  TraceStep: "#8b98a9",
  Cluster: "#30363d",
  Tenant: "#8b98a9",
};

function colorFor(labels: string[]): string {
  for (const l of labels) if (LABEL_COLOR[l]) return LABEL_COLOR[l];
  return "#8b98a9";
}

function NodeCard({ data }: { data: { node: CanvasNode; lit: boolean; seed: boolean } }) {
  const { node, lit, seed } = data;
  const color = colorFor(node.labels);
  const kind = node.labels[0] ?? "?";
  return (
    <div
      className="rounded-md border px-3 py-2 text-left transition-all duration-200"
      style={{
        minWidth: 150,
        maxWidth: 190,
        borderColor: lit ? color : "var(--border-strong)",
        background: lit ? `${color}22` : "var(--panel-2)",
        boxShadow: lit ? `0 0 22px ${color}66` : seed ? `0 0 0 1px ${color}55` : "none",
        transform: lit ? "scale(1.04)" : "scale(1)",
      }}
    >
      <div className="micro" style={{ color }}>
        {kind}
      </div>
      <div className="mt-0.5 truncate text-[12.5px] font-semibold text-foreground">
        {node.label}
      </div>
      {typeof node.properties.tier === "number" && (
        <div className="micro mt-0.5">tier {node.properties.tier}</div>
      )}
      {typeof node.properties.severity === "number" && (
        <div className="micro mt-0.5" style={{ color: "#f85149" }}>
          sev {node.properties.severity} · {String(node.properties.status ?? "")}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { card: NodeCard };

interface Props {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  seed: string;
  /** names of entities lit on the current replay step */
  highlight: Set<string>;
}

/** Deterministic layered layout: BFS depth from seed → column, alphabetical rows. */
function layout(nodes: CanvasNode[], edges: CanvasEdge[], seedName: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    if (!adjacency.has(e.target)) adjacency.set(e.target, []);
    adjacency.get(e.source)!.push(e.target);
    adjacency.get(e.target)!.push(e.source);
  }
  const seedNode = nodes.find((n) => n.label === seedName) ?? nodes[0];
  const depth = new Map<string, number>();
  if (seedNode) {
    const queue = [seedNode.id];
    depth.set(seedNode.id, 0);
    while (queue.length) {
      const id = queue.shift()!;
      for (const nb of adjacency.get(id) ?? []) {
        if (!depth.has(nb) && byId.has(nb)) {
          depth.set(nb, depth.get(id)! + 1);
          queue.push(nb);
        }
      }
    }
  }
  const columns = new Map<number, CanvasNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 99;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(n);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [d, col] of columns) {
    col.sort((a, b) => a.label.localeCompare(b.label));
    col.forEach((n, i) => {
      positions.set(n.id, { x: d * 260, y: i * 110 - (col.length * 110) / 2 });
    });
  }
  return { positions, seedId: seedNode?.id };
}

export default function GraphCanvas({ nodes, edges, seed, highlight }: Props) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [, setTick] = useState(0);

  const { positions, seedId } = useMemo(
    () => layout(nodes, edges, seed),
    [nodes, edges, seed],
  );

  // Rebuild node/edge objects whenever data or highlight changes.
  useEffect(() => {
    const nextNodes: Node[] = nodes.map((n) => ({
      id: n.id,
      type: "card",
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { node: n, lit: highlight.has(n.label), seed: n.id === seedId },
      draggable: false,
    }));
    const litIds = new Set(
      nodes.filter((n) => highlight.has(n.label)).map((n) => n.id),
    );
    const nextEdges: Edge[] = edges.map((e) => {
      const lit = litIds.has(e.source) && litIds.has(e.target);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: lit,
        style: {
          stroke: lit ? "#ff8101" : "#2b3646",
          strokeWidth: lit ? 2.2 : 1.2,
          opacity: highlight.size === 0 ? 0.9 : lit ? 1 : 0.25,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: lit ? "#ff8101" : "#2b3646" },
      };
    });
    setRfNodes(nextNodes);
    setRfEdges(nextEdges);
  }, [nodes, edges, positions, highlight, seedId, setRfNodes, setRfEdges]);

  const onInit = useCallback(() => setTick((t) => t + 1), []);

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        No graph loaded — connect FalkorDB and re-seed.
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onInit={onInit}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.2}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll
      preventScrolling
    >
      <Background color="#1c2431" gap={28} size={1} />
      <Controls showInteractive={false} position="bottom-right" />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => colorFor((n.data as { node: CanvasNode }).node.labels)}
        maskColor="rgba(7,10,15,0.72)"
        style={{ background: "var(--panel)" }}
      />
    </ReactFlow>
  );
}
