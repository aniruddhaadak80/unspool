"use client";

import { useState } from "react";
import type { TraceStep } from "@/lib/client/types";

/**
 * The reasoning trace, read straight from FalkorDB (:TraceStep nodes).
 * Click a step to expand the exact Cypher / detail behind it. During replay the
 * active step is highlighted in lockstep with the canvas.
 */

const KIND_META: Record<string, { label: string; color: string }> = {
  read_memory: { label: "recall", color: "#d29922" },
  query_graph: { label: "cypher", color: "#58a6ff" },
  algorithm: { label: "algorithm", color: "#a371f7" },
  write_memory: { label: "write", color: "#3fb950" },
  decide: { label: "decide", color: "#f0883e" },
  act: { label: "act", color: "#f85149" },
};

interface Props {
  steps: TraceStep[];
  activeIdx: number;
}

export default function TraceTimeline({ steps, activeIdx }: Props) {
  const [open, setOpen] = useState<number | null>(null);

  if (steps.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-faint">
        Ask a question — every Cypher call, algorithm and action will appear here
        as a replayable trace.
      </div>
    );
  }

  return (
    <ol className="space-y-1 px-2 py-2">
      {steps.map((s, i) => {
        const p = s.properties;
        const meta = KIND_META[p.kind] ?? { label: p.kind, color: "#8b98a9" };
        const active = i === activeIdx;
        const done = i < activeIdx;
        const isOpen = open === i;
        return (
          <li key={s.id}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              className="w-full rounded-md border px-2.5 py-2 text-left transition-colors"
              style={{
                borderColor: active ? meta.color : "transparent",
                background: active ? `${meta.color}14` : "transparent",
                opacity: done || active ? 1 : 0.55,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="micro rounded px-1.5 py-0.5"
                  style={{ color: meta.color, background: `${meta.color}1f` }}
                >
                  {String(p.idx ?? i + 1).padStart(2, "0")} {meta.label}
                </span>
                <span className="flex-1 truncate text-[12.5px] text-foreground">
                  {p.summary}
                </span>
              </div>
              {isOpen && (
                <div className="fade-rise mt-2 space-y-2">
                  {p.cypher && (
                    <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[11px] leading-relaxed text-muted">
                      {p.cypher}
                    </pre>
                  )}
                  {p.detail && (
                    <p className="whitespace-pre-wrap text-[11.5px] text-muted">{p.detail}</p>
                  )}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
