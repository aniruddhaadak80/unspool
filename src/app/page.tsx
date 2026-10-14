"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import GraphCanvas from "@/components/graph-canvas";
import ChatPanel from "@/components/chat-panel";
import TraceTimeline from "@/components/trace-timeline";
import MemoryPanel from "@/components/memory-panel";
import AnalysisPanel from "@/components/analysis-panel";
import CypherConsole from "@/components/cypher-console";
import type {
  AgentResult,
  CanvasEdge,
  CanvasNode,
  Health,
  MemorySets,
} from "@/lib/client/types";

const TENANTS = [
  { id: "demo", label: "acme-prod" },
  { id: "acme", label: "acme-staging" },
  { id: "demo2", label: "acme-sandbox" },
];

const SUGGESTIONS = [
  "Why is checkout failing, and who should I page?",
  "Who owns the risk engine and who's on call?",
  "What breaks if the ledger goes down?",
  "What did we learn from the last payments incident?",
];

const MEM_TABS = ["episodic", "semantic", "procedural"] as const;
type MemTab = (typeof MEM_TABS)[number];

interface Turn {
  role: "user" | "agent";
  text: string;
  result?: AgentResult;
}

export default function MissionControl() {
  const [tenant, setTenant] = useState("demo");
  const [health, setHealth] = useState<Health | null>(null);
  const [seed, setSeed] = useState("checkout-api");
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [memories, setMemories] = useState<MemorySets>({ episodic: [], semantic: [], procedural: [] });
  const [memTab, setMemTab] = useState<MemTab>("episodic");
  const [conversation, setConversation] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeRun, setActiveRun] = useState<AgentResult | null>(null);
  const [activeStep, setActiveStep] = useState(-1);
  const [drawer, setDrawer] = useState<"analysis" | "cypher" | null>(null);
  const replayTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadGraph = useCallback(async (t: string, s: string) => {
    try {
      const res = await fetch(`/api/graph?tenant=${t}&seed=${s}&hops=2`);
      if (!res.ok) return;
      const data = await res.json();
      setNodes(data.nodes ?? []);
      setEdges(data.edges ?? []);
    } catch {
      /* canvas stays empty; UI already handles it */
    }
  }, []);

  const loadMemories = useCallback(async (t: string) => {
    try {
      const res = await fetch(`/api/runs?tenant=${t}`);
      if (!res.ok) return;
      const data = await res.json();
      setMemories({
        episodic: data.episodic ?? [],
        semantic: data.semantic ?? [],
        procedural: data.procedural ?? [],
      });
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    loadGraph(tenant, seed);
    loadMemories(tenant);
  }, [tenant, seed, loadGraph, loadMemories]);

  // Replay driver: advance the active step on a timer so the canvas lights up
  // hop by hop. Cleans up on unmount.
  useEffect(() => {
    if (!activeRun || activeRun.steps.length === 0) return;
    setActiveStep(0);
    let i = 0;
    replayTimer.current = setInterval(() => {
      i += 1;
      if (i >= activeRun.steps.length) {
        if (replayTimer.current) clearInterval(replayTimer.current);
        return;
      }
      setActiveStep(i);
    }, 1100);
    return () => {
      if (replayTimer.current) clearInterval(replayTimer.current);
    };
  }, [activeRun]);

  const highlight = useMemo(() => {
    const set = new Set<string>();
    if (!activeRun || activeStep < 0) return set;
    for (let i = 0; i <= activeStep && i < activeRun.steps.length; i++) {
      for (const t of activeRun.steps[i].touches ?? []) set.add(t);
    }
    return set;
  }, [activeRun, activeStep]);

  const ask = async (question: string) => {
    setBusy(true);
    setConversation((c) => [...c, { role: "user", text: question }]);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, tenantId: tenant, focus: seed }),
      });
      const data = (await res.json()) as AgentResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "agent failed");
      setActiveRun(data);
      setConversation((c) => [...c, { role: "agent", text: data.answer, result: data }]);
      loadMemories(tenant); // memory writes just landed — refresh panel
      loadGraph(tenant, seed); // actions/incidents may have changed topology
    } catch (err) {
      setConversation((c) => [
        ...c,
        { role: "agent", text: `Something went wrong: ${(err as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const reseed = async () => {
    setConversation((c) => [...c, { role: "agent", text: `Re-seeding graph for ${tenant}…` }]);
    try {
      const res = await fetch(`/api/seed?tenant=${tenant}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "seed failed");
      setConversation((c) => [
        ...c,
        { role: "agent", text: `Graph rebuilt: ${data.stats.nodes} nodes, ${data.stats.rels} relationships.` },
      ]);
      loadGraph(tenant, seed);
      loadMemories(tenant);
    } catch (err) {
      setConversation((c) => [...c, { role: "agent", text: `Seed failed: ${(err as Error).message}` }]);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* ---------- top bar ---------- */}
      <header className="flex items-center gap-4 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-7 w-7 place-items-center rounded-md font-black"
            style={{ background: "var(--accent)", color: "#0a0a0a" }}
          >
            U
          </span>
          <div>
            <div className="text-[15px] font-bold leading-none">Unspool</div>
            <div className="micro mt-0.5">incident command · shows its work</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {TENANTS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTenant(t.id)}
              className="micro rounded border px-2 py-1 transition-colors"
              style={{
                borderColor: tenant === t.id ? "var(--accent)" : "var(--border-strong)",
                color: tenant === t.id ? "var(--accent)" : "var(--faint)",
              }}
            >
              {t.label}
            </button>
          ))}
          <span className="micro ml-1">isolated graph + memory per tenant</span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {health && (
            <>
              <Badge
                dot={health.falkordb === "ok" ? "good" : health.falkordb === "error" ? "bad" : "warn"}
                label={`falkordb ${health.falkordb}`}
              />
              <Badge dot={health.agent === "live-llm" ? "good" : "warn"} label={health.model} />
              {health.graph && health.graph.nodes > 0 && (
                <span className="micro text-faint">
                  {health.graph.nodes} nodes · {health.graph.rels} rels
                  {health.algorithms && health.algorithms.length > 0
                    ? ` · ${health.algorithms.length} algo`
                    : ""}
                </span>
              )}
            </>
          )}
          <button
            onClick={reseed}
            className="micro rounded border border-border-strong px-2 py-1 text-muted transition-colors hover:border-accent hover:text-foreground"
          >
            re-seed graph
          </button>
        </div>
      </header>

      {/* ---------- workspace ---------- */}
      <main className="grid flex-1 grid-cols-12 gap-3 p-3">
        {/* chat */}
        <section className="panel col-span-3 flex flex-col overflow-hidden">
          <PanelHead title="Command channel" note="ask · decide · act" />
          <div className="min-h-0 flex-1">
            <ChatPanel onAsk={ask} busy={busy} conversation={conversation} suggestions={SUGGESTIONS} />
          </div>
        </section>

        {/* canvas */}
        <section className="panel workspace-grid relative col-span-6 flex flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[12.5px] font-semibold">Company graph</span>
              <span className="micro">
                {nodes.length} nodes · {edges.length} edges · live from falkordb
              </span>
            </div>
            <div className="flex items-center gap-1">
              <ToolBtn active={drawer === "analysis"} onClick={() => setDrawer(drawer === "analysis" ? null : "analysis")}>
                analysis
              </ToolBtn>
              <ToolBtn active={drawer === "cypher"} onClick={() => setDrawer(drawer === "cypher" ? null : "cypher")}>
                cypher console
              </ToolBtn>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <GraphCanvas nodes={nodes} edges={edges} seed={seed} highlight={highlight} />
            {activeRun && (
              <div className="pointer-events-none absolute bottom-3 left-3 max-w-md rounded-md border border-border bg-panel/90 px-3 py-2">
                <div className="micro" style={{ color: "var(--accent)" }}>
                  replay · step {Math.max(activeStep + 1, 0)}/{activeRun.steps.length}
                  {activeRun.acted ? " · agent acted" : ""}
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {activeRun.steps[activeStep]?.properties.summary ?? "…"}
                </div>
              </div>
            )}
          </div>
          {drawer && (
            <div
              className="h-48 shrink-0 overflow-hidden border-t border-border"
              style={{ background: "var(--panel-2)" }}
            >
              {drawer === "analysis" ? <AnalysisPanel tenant={tenant} /> : <CypherConsole tenant={tenant} />}
            </div>
          )}
        </section>

        {/* right rail: trace + memory */}
        <section className="col-span-3 flex min-h-0 flex-col gap-3">
          <div className="panel flex min-h-0 flex-[3] flex-col overflow-hidden">
            <PanelHead title="Reasoning trace" note="every step is a graph node" />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <TraceTimeline steps={activeRun?.steps ?? []} activeIdx={activeStep} />
            </div>
          </div>
          <div className="panel flex min-h-0 flex-[2] flex-col overflow-hidden">
            <PanelHead title="Agent memory" note="episodic · semantic · procedural" />
            <div className="min-h-0 flex-1">
              <MemoryPanel memories={memories} tab={memTab} onTab={setMemTab} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function PanelHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border px-3 py-2">
      <span className="text-[12.5px] font-semibold">{title}</span>
      {note && <span className="micro">{note}</span>}
    </div>
  );
}

function Badge({ dot, label }: { dot: "good" | "warn" | "bad"; label: string }) {
  const color = dot === "good" ? "var(--good)" : dot === "warn" ? "var(--warn)" : "var(--bad)";
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="micro">{label}</span>
    </span>
  );
}

function ToolBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="micro rounded border px-2 py-1 transition-colors"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border-strong)",
        color: active ? "var(--accent)" : "var(--faint)",
      }}
    >
      {children}
    </button>
  );
}
