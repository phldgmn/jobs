import { useState } from "react";
import { Alert, Button, Card, Collapse, Input, Space, Spin, Typography } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { XMarkdown } from "@ant-design/x-markdown";
import "@ant-design/x-markdown/themes/light.css";
import { errMessage } from "./api";

type Msg = { role: "user" | "assistant"; content: string; thinking?: string };
// Mirrors ChatDelta from src/llm.ts; not imported so server code (openai) stays out of the bundle.
type Delta = { type: "thinking" | "content" | "error"; text: string };

const starters = [
  "Which jobs give me the highest chance of success, and why?",
  "What am I missing for my top 3 matches?",
  "Which deadlines are coming up?",
];

export function ChatPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Appends one streamed delta to the trailing assistant message.
  const apply = (d: Delta) => {
    if (d.type === "error") throw new Error(d.text);
    setMsgs(prev => {
      const last = prev[prev.length - 1];
      const updated =
        d.type === "thinking"
          ? { ...last, thinking: (last.thinking ?? "") + d.text }
          : { ...last, content: last.content + d.text };
      return [...prev.slice(0, -1), updated];
    });
  };

  // Streams a reply to `history` (which must end with the user message).
  const run = async (history: Msg[]) => {
    setMsgs([...history, { role: "assistant", content: "", thinking: "" }]);
    setBusy(true);
    setError(null);
    let gotAny = false;
    const take = (d: Delta) => {
      gotAny = true;
      apply(d);
    };
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const err: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(err.error ?? res.statusText);
      }
      // NDJSON: one ChatDelta per line.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const lines = (buf + value).split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) take(JSON.parse(line));
      }
      if (buf.trim()) take(JSON.parse(buf));
      // Stream closed with no deltas: report it instead of leaving an empty Advisor card.
      if (!gotAny) throw new Error("Model returned no response.");
    } catch (e) {
      setError(errMessage(e));
      // Drop the empty placeholder so the user message stays as the retry target.
      setMsgs(prev => {
        const last = prev[prev.length - 1];
        return last.role === "assistant" && !last.content && !last.thinking ? prev.slice(0, -1) : prev;
      });
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void run([...msgs, { role: "user", content: text }]);
  };

  // Retry re-sends the trailing user message left behind by a failed run.
  const canRetry = !busy && error !== null && msgs[msgs.length - 1]?.role === "user";
  const retry = () => {
    if (canRetry) void run(msgs);
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <Card title="Chat">
        <Space orientation="vertical" style={{ width: "100%" }}>
          {msgs.map((m, i) => {
            const working = busy && i === msgs.length - 1 && m.role === "assistant";
            return (
              <Card key={i} size="small" type={m.role === "user" ? "inner" : undefined}>
                <Typography.Text strong>{m.role === "user" ? "You" : "Advisor"}</Typography.Text>
                {m.thinking && (
                  <Collapse
                    ghost
                    size="small"
                    // Open while thinking; collapse as soon as answer text starts.
                    activeKey={m.content ? [] : ["thinking"]}
                    items={[
                      {
                        key: "thinking",
                        label: "Thinking",
                        children: (
                          <Typography.Paragraph type="secondary" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                            {m.thinking}
                          </Typography.Paragraph>
                        ),
                      },
                    ]}
                  />
                )}
                {m.content && (
                  <XMarkdown
                    content={m.content}
                    streaming={{ hasNextChunk: busy && i === msgs.length - 1, tail: busy && i === msgs.length - 1 }}
                  />
                )}
                {working && (
                  <Space size="small" style={{ marginTop: 8 }}>
                    <Spin size="small" />
                    <Typography.Text type="secondary">
                      {m.content ? "Writing…" : m.thinking ? "Thinking…" : "Working…"}
                    </Typography.Text>
                  </Space>
                )}
              </Card>
            );
          })}
          {error && (
            <Alert
              type="error"
              title={error}
              showIcon
              action={
                canRetry ? (
                  <Button size="small" danger onClick={retry}>
                    Retry
                  </Button>
                ) : undefined
              }
            />
          )}
        </Space>
      </Card>

      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          {starters.map(s => (
            <Button key={s} onClick={() => setInput(s)}>
              {s}
            </Button>
          ))}
        </Space>
        <Input.TextArea
          rows={4}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          placeholder="Ask about your matches (Cmd/Ctrl+Enter to send)"
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={busy}
          disabled={!input.trim()}
          onClick={send}
          style={{ marginTop: 12 }}
        >
          Send
        </Button>
      </Card>
    </Space>
  );
}
