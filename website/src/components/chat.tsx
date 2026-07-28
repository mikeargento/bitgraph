"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";


interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatProps {
  proofContext?: Record<string, unknown>;
  preloadedQuestions?: string[];
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}

const DEFAULT_QUESTIONS = [
  "What is provenance?",
  "What does a BitGraph prove?",
  "What problem does BitGraph solve?",
  "How is this different from a timestamp?",
  "Why not just hash a file?",
  "What makes a BitGraph hard to fake?",
  "Does a BitGraph prove when something happened?",
  "How do I verify a BitGraph?",
  "Is my file ever uploaded?",
  "What data does BitGraph store about me?",
  "What are Ethereum anchors?",
  "What happens if the server disappears?",
  "Why not use a blockchain?",
  "What is a causal slot?",
];

export function Chat({ proofContext, preloadedQuestions, onOpenChange, defaultOpen }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [open, setOpen] = useState(defaultOpen ?? false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const questions = preloadedQuestions || DEFAULT_QUESTIONS;

  useEffect(() => {
    if (messages.length > 0) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      const userMsg: Message = { role: "user", content: text };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setInput("");
      setStreaming(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: newMessages,
            proofContext,
          }),
        });

        if (!res.ok) throw new Error("Chat failed");

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No reader");

        const decoder = new TextDecoder();
        let assistantText = "";
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.text) {
                  assistantText += parsed.text;
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: "assistant",
                      content: assistantText,
                    };
                    return updated;
                  });
                }
              } catch {
                // skip malformed chunks
              }
            }
          }
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Something went wrong. Try again." },
        ]);
      } finally {
        setStreaming(false);
      }
    },
    [messages, proofContext]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    sendMessage(input.trim());
  };

  if (!open) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
        <button
          onClick={() => { setOpen(true); onOpenChange?.(true); }}
          style={{
            background: "#0065A4",
            border: "1px solid #0065A4",
            borderRadius: 0,
            padding: "10px 20px",
            color: "#ffffff",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#004d7a";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#0065A4";
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          How it works
        </button>
      </div>
    );
  }

  return (
    <div>
    <div className="bitgraph-chat-panel"
      style={{
        width: "100%",
        maxHeight: "calc(100dvh - 200px)",
        background: "#ffffff",
        borderRadius: 0,
        border: "1px solid #d0d5dd",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #e2e5e9",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 16, color: "#111827" }}>How it works</span>
        <button
          onClick={() => { setOpen(false); onOpenChange?.(false); }}
          style={{
            background: "none",
            border: "none",
            color: "#111827",
            cursor: "pointer",
            fontSize: 36,
            fontWeight: 700,
            lineHeight: 1,
            padding: "4px 8px",
          }}
        >
          &times;
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          justifyContent: messages.length === 0 ? "flex-start" : undefined,
        }}
      >
        {messages.length === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {questions.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                disabled={streaming}
                style={{
                  background: "#f9fafb",
                  border: "1px solid #d0d5dd",
                  borderRadius: 0,
                  padding: "8px 14px",
                  color: "#374151",
                  fontSize: 15,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0,101,164,0.1)";
                  e.currentTarget.style.borderColor = "rgba(0,101,164,0.3)";
                  e.currentTarget.style.color = "#0065A4";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#f9fafb";
                  e.currentTarget.style.borderColor = "#d0d5dd";
                  e.currentTarget.style.color = "#374151";
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
            }}
          >
            <div
              style={{
                background:
                  msg.role === "user"
                    ? "#0065A4"
                    : "#f3f4f6",
                color: msg.role === "user" ? "#ffffff" : "#1f2937",
                borderRadius:
                  msg.role === "user"
                    ? "16px 16px 4px 16px"
                    : "16px 16px 16px 4px",
                padding: "10px 14px",
                fontSize: 16,
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              {msg.role === "assistant" ? (
                <>
                  <div className="bitgraph-chat-md"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                </>
              ) : msg.content}
              {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                <span
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 14,
                    background: "#0065A4",
                    marginLeft: 2,
                    animation: "blink 1s infinite",
                    verticalAlign: "text-bottom",
                  }}
                />
              )}
            </div>
          </div>
        ))}
        {messages.length > 0 && !streaming && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 4 }}>
            <button
              onClick={() => setMessages(prev => prev.length <= 2 ? [] : prev.slice(0, -2))}
              style={{
                background: "none", border: "none", color: "#0065A4", fontSize: 13,
                fontWeight: 500, cursor: "pointer", padding: "2px 0",
              }}
            >
              ← {messages.length <= 2 ? "Back to questions" : "Remove last"}
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: "12px 16px",
          borderTop: "1px solid #e2e5e9",
          display: "flex",
          gap: 8,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about BitGraph..."
          disabled={streaming}
          style={{
            flex: 1,
            background: "#f9fafb",
            border: "1px solid #d0d5dd",
            borderRadius: 0,
            padding: "10px 14px",
            color: "#1f2937",
            fontSize: 16,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || streaming}
          style={{
            background: input.trim() && !streaming ? "#0065A4" : "#e5e7eb",
            border: "none",
            borderRadius: 0,
            padding: "10px 14px",
            color: input.trim() && !streaming ? "#ffffff" : "#636a78",
            fontSize: 16,
            fontWeight: 600,
            cursor: input.trim() && !streaming ? "pointer" : "default",
          }}
        >
          Send
        </button>
      </form>

      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .bitgraph-chat-md p { margin: 0 0 8px; }
        .bitgraph-chat-md p:last-child { margin-bottom: 0; }
        .bitgraph-chat-md strong { color: #111827; font-weight: 600; }
        .bitgraph-chat-md ul, .bitgraph-chat-md ol { margin: 4px 0 8px; padding-left: 18px; }
        .bitgraph-chat-md li { margin-bottom: 4px; }
        .bitgraph-chat-md code { background: #e5e7eb; padding: 1px 5px; border-radius: 0; font-size: 13px; }
        .bitgraph-chat-md h1, .bitgraph-chat-md h2, .bitgraph-chat-md h3 { font-size: 14px; font-weight: 600; color: #111827; margin: 8px 0 4px; }
        @media (max-width: 640px) {
          .bitgraph-chat-panel {
            position: fixed !important;
            inset: 56px 0 0 0 !important;
            width: 100% !important;
            height: calc(100dvh - 56px) !important;
            aspect-ratio: unset !important;
            max-height: none !important;
            border-radius: 0 !important;
            border: none !important;
            border-top: 1px solid #e5e7eb !important;
            z-index: 60 !important;
          }
        }
      `}</style>
    </div>
    </div>
  );
}
