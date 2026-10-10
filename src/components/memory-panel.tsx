"use client";

import type { MemorySets } from "@/lib/client/types";

/**
 * The agent's persistent memory, live from FalkorDB — three tabs for the three
 * memory types the brief calls for. Because each memory is a node linked to
 * what it is ABOUT, this panel is a direct query, not a cache.
 */

const TABS = ["episodic", "semantic", "procedural"] as const;
type Tab = (typeof TABS)[number];

const TAB_COPY: Record<Tab, string> = {
  episodic: "What happened — incidents, pages, resolutions",
  semantic: "What is true — durable facts about the org",
  procedural: "How to act — rules and playbooks",
};

const TAB_COLOR: Record<Tab, string> = {
  episodic: "#d29922",
  semantic: "#58a6ff",
  procedural: "#3fb950",
};

interface Props {
  memories: MemorySets;
  tab: Tab;
  onTab: (t: Tab) => void;
}

export default function MemoryPanel({ memories, tab, onTab }: Props) {
  const items = memories[tab] ?? [];
  const color = TAB_COLOR[tab];

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-border px-2 py-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => onTab(t)}
            className="micro rounded px-2 py-1 transition-colors"
            style={{
              color: tab === t ? TAB_COLOR[t] : "var(--faint)",
              background: tab === t ? `${TAB_COLOR[t]}1a` : "transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="px-3 py-1.5 text-[11px] italic text-faint">{TAB_COPY[tab]}</div>
      <ul className="flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
        {items.length === 0 && (
          <li className="px-1 py-4 text-center text-xs text-faint">
            No {tab} memory yet — the agent writes here as it works.
          </li>
        )}
        {items.map((m) => (
          <li
            key={m.id}
            className="rounded-md border border-border bg-panel-2 px-2.5 py-2"
            style={{ borderLeft: `2px solid ${color}` }}
          >
            <div className="micro" style={{ color }}>
              {String(m.properties.key ?? "memory")}
            </div>
            <p className="mt-0.5 text-[12px] leading-snug text-foreground">
              {String(m.properties.value ?? "")}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
