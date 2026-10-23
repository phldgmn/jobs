import { useEffect, useState } from "react";
import { Alert, Button, Card, Popover, Space, Table, Tabs, Tag, Tooltip, Typography } from "antd";
import { LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { errMessage, req } from "./api";
import type { ActiveTask, FailedTask } from "../schemas";

const kindLabel: Record<ActiveTask["kind"], string> = { parse: "Parse job", evaluate: "Evaluate fit" };

// "42s", "3m 04s", "1h 02m". Negative or invalid input shows "–".
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// Short code for the Error column; full message goes in the popover. Unknown messages fall back to "ERROR".
function errorCode(msg: string): string {
  const http = /^HTTP (\d{3})/.exec(msg);
  if (http) return `HTTP ${http[1]}`;
  if (msg.includes("too little text")) return "NO_TEXT";
  if (msg.includes("invalid JSON")) return "BAD_JSON";
  return "ERROR";
}

// SQLite datetime('now') is "YYYY-MM-DD HH:MM:SS" in UTC.
const fromSqlite = (s: string) => new Date(s.replace(" ", "T") + "Z");

// Title when parsed; otherwise a link icon whose tooltip is the full URL.
function JobCell({ t }: { t: ActiveTask | FailedTask }) {
  if (t.title) return <a href={t.url} target="_blank" rel="noreferrer">{t.title}</a>;
  return (
    <Tooltip title={t.url}>
      <a href={t.url} target="_blank" rel="noreferrer" aria-label={t.url}>
        <LinkOutlined />
      </a>
    </Tooltip>
  );
}

export function TasksPage() {
  const [tab, setTab] = useState<"active" | "failed">("active");
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title="AI tasks">
      {error && (
        <Alert type="error" title={error} showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16 }} />
      )}
      <Tabs
        activeKey={tab}
        onChange={k => setTab(k as "active" | "failed")}
        items={[
          { key: "active", label: "Active", children: <ActiveTasks setError={setError} /> },
          { key: "failed", label: "Failed", children: <FailedTasks setError={setError} /> },
        ]}
      />
    </Card>
  );
}

// Ticks once per second so runtimes stay live between server polls.
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function ActiveTasks({ setError }: { setError: (s: string | null) => void }) {
  const [tasks, setTasks] = useState<ActiveTask[]>([]);
  const now = useNow();

  useEffect(() => {
    const load = () =>
      req<ActiveTask[]>("GET", "/api/tasks/active")
        .then(setTasks)
        .catch(e => setError(errMessage(e)));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [setError]);

  return (
    <Table<ActiveTask>
      rowKey="id"
      size="small"
      pagination={false}
      dataSource={tasks}
      locale={{ emptyText: "No active AI tasks" }}
      columns={[
        { title: "Task", render: (_, t) => kindLabel[t.kind] },
        { title: "Job", render: (_, t) => <JobCell t={t} /> },
        {
          title: "State",
          render: (_, t) => (t.state === "running" ? <Tag color="processing">running</Tag> : <Tag>queued</Tag>),
        },
        {
          title: "Runtime",
          render: (_, t) => (t.state === "running" ? formatDuration(now - fromSqlite(t.startedAt!).getTime()) : "–"),
        },
        { title: "Queued", render: (_, t) => fromSqlite(t.queuedAt).toLocaleTimeString() },
      ]}
    />
  );
}

function FailedTasks({ setError }: { setError: (s: string | null) => void }) {
  const [tasks, setTasks] = useState<FailedTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    req<FailedTask[]>("GET", "/api/tasks/failed")
      .then(setTasks)
      .catch(e => setError(errMessage(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const retry = (id: number) => {
    setRetrying(id);
    req("POST", `/api/tasks/failed/${id}/retry`)
      .then(load)
      .catch(e => setError(errMessage(e)))
      .finally(() => setRetrying(null));
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
          Refresh
        </Button>
      </Space>
      <Table<FailedTask>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={tasks}
        locale={{ emptyText: "No failed AI tasks" }}
        expandable={{ expandedRowRender: t => <RequestDetails task={t} /> }}
        columns={[
          { title: "Task", render: (_, t) => kindLabel[t.kind] },
          { title: "Job", render: (_, t) => <JobCell t={t} /> },
          {
            title: "Error",
            render: (_, t: FailedTask) => (
              <Popover content={<div style={{ maxWidth: 480, whiteSpace: "pre-wrap" }}>{t.error}</div>} title="Error" trigger="click">
                <Tag color="error" style={{ cursor: "pointer" }}>{errorCode(t.error)}</Tag>
              </Popover>
            ),
          },
          { title: "Failed at", render: (_, t) => fromSqlite(t.failedAt).toLocaleString() },
          {
            title: "",
            render: (_, t) => (
              <Button size="small" onClick={() => retry(t.id)} loading={retrying === t.id}>
                Retry
              </Button>
            ),
          },
        ]}
      />
    </>
  );
}

// Prompt sent to the model. Null when the failure happened before any model call (e.g. page fetch).
function RequestDetails({ task }: { task: FailedTask }) {
  if (!task.request) {
    return <Typography.Text type="secondary">Failed before any model call; no request was sent.</Typography.Text>;
  }
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Typography.Text>
        Model: <code>{task.request.model}</code>
      </Typography.Text>
      <Typography.Text strong>System</Typography.Text>
      <pre style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>{task.request.system}</pre>
      <Typography.Text strong>User</Typography.Text>
      <pre style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>{task.request.user}</pre>
    </Space>
  );
}
