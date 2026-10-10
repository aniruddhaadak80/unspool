"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentResult } from "@/lib/client/types";

interface Props {
  onAsk: (q: string) => void;
  busy: boolean;
  conversation: Array<{ role: "user" | "agent"; text: string; result?: AgentResult }>;
  suggestions: string[];
}

export default function ChatPanel({ onAsk, busy, conversation, suggestions }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation, busy]);

  const submit = (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    onAsk(q);
    setInput("");
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {conversation.length === 0 && (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Ask about the payments outage, or run one of these:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="rounded-full border border-border-strong px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-accent hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {conversation.map((m, i) => (
          <div key={i} className="fade-rise">
            {m.role === "user" ? (
              <div className="ml-6 rounded-lg rounded-br-sm bg-panel-2 px-3 py-2 text-[13px] text-foreground">
                {m.text}
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="micro">unspool agent</div>
                <div className="whitespace-pre-wrap rounded-lg rounded-bl-sm border border-border bg-panel px-3 py-2 text-[13px] leading-relaxed text-foreground">
                  <Markdownish text={m.text} />
                </div>
                {m.result && (
                  <div className="micro px-1">
                    {m.result.live ? "live llm" : "graph-replay"} ·{" "}
                    {m.result.steps.length} trace steps ·{" "}
                    {m.result.acted ? "acted" : "read-only"}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="micro animate-pulse px-1">
            investigating the graph — watch the canvas and trace fill in…
          </div>
        )}
      </div>

      <div className="border-t border-border p-2">
        <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-panel-2 px-3 py-1.5 focus-within:border-accent">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit(input)}
            placeholder="e.g. Why is checkout failing, and who should I page?"
            className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
          />
          <button
            onClick={() => submit(input)}
            disabled={busy || !input.trim()}
            className="micro rounded px-2.5 py-1 text-foreground transition-colors disabled:opacity-40"
            style={{ background: "var(--accent)", color: "#0a0a0a" }}
          >
            ask
          </button>
        </div>
      </div>
    </div>
  );
}

/** Tiny **bold** / `code` renderer so answers read well without a markdown dep. */
function Markdownish({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**"))
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`"))
          return (
            <code key={i} className="rounded bg-background px-1 py-0.5 font-mono text-[12px] text-accent-2">
              {p.slice(1, -1)}
            </code>
          );
        if (p.startsWith("[") && p.endsWith("]"))
          return (
            <span key={i} className="rounded bg-background px-1 py-0.5 font-mono text-[12px] text-accent">
              {p}
            </span>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}
