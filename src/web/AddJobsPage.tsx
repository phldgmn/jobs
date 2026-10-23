import { useState } from "react";
import { Alert, App as AntApp, Button, Card, Input, Space, Spin, Typography } from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { errMessage, req } from "./api";
import { useJobs } from "./useJobs";
import type { Job } from "../schemas";

type AddResult = { added: number[]; skipped: string[] };

export function AddJobsPage() {
  const { jobs, error, setError, reload } = useJobs();
  const [urls, setUrls] = useState("");
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<AddResult | null>(null);

  const processing = jobs.filter(j => j.status !== "parsed");

  const addUrls = async () => {
    setError(null);
    setAdding(true);
    try {
      const res = await req<AddResult>("POST", "/api/jobs", { urls: urls.split("\n") });
      setAddResult(res);
      setUrls("");
      reload();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      {error && <Alert type="error" title={error} showIcon closable onClose={() => setError(null)} />}

      <Card
        title="Add jobs"
        extra={
          <Button type="primary" onClick={addUrls} loading={adding} disabled={!urls.trim()}>
            Add
          </Button>
        }
      >
        <Input.TextArea
          rows={4}
          placeholder="One job URL per line"
          value={urls}
          onChange={e => setUrls(e.target.value)}
        />
        {addResult && (
          <Typography.Text style={{ display: "block", marginTop: 12 }}>
            Added {addResult.added.length}. Skipped: {addResult.skipped.join(", ") || "none"}
          </Typography.Text>
        )}
      </Card>

      {processing.length > 0 && (
        <Card title="Processing / failed">
          <Space orientation="vertical" style={{ width: "100%" }}>
            {processing.map(j => (
              <ProcessingRow key={j.id} job={j} onChange={reload} />
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
}

function ProcessingRow({ job, onChange }: { job: Job; onChange: () => void }) {
  const { message, modal } = AntApp.useApp();
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const pending = job.status === "pending";

  const run = (p: Promise<unknown>) => p.then(onChange).catch(e => message.error(errMessage(e)));

  const remove = () =>
    modal.confirm({
      title: "Delete this job?",
      okText: "Delete",
      okType: "danger",
      onOk: () => run(req("DELETE", `/api/jobs/${job.id}`)),
    });

  return (
    <Card size="small">
      <Typography.Paragraph copyable style={{ marginBottom: 8 }}>
        <a href={job.url} target="_blank" rel="noreferrer">
          {job.url}
        </a>
      </Typography.Paragraph>
      {pending ? (
        <Space>
          <Spin size="small" />
          <Typography.Text>Processing…</Typography.Text>
        </Space>
      ) : (
        <Alert type="error" title={job.error} showIcon />
      )}
      {!pending && (
        <Space wrap style={{ marginTop: 12 }}>
          <Button icon={<EditOutlined />} onClick={() => setPasting(p => !p)}>
            Paste text
          </Button>
          <Button onClick={() => run(req("POST", `/api/jobs/${job.id}/reparse`, { refetch: true }))}>
            Retry
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={remove}>
            Delete
          </Button>
        </Space>
      )}
      {!pending && pasting && (
        <Space orientation="vertical" style={{ width: "100%", marginTop: 12 }}>
          <Input.TextArea rows={6} value={text} onChange={e => setText(e.target.value)} />
          <Button type="primary" onClick={() => run(req("POST", `/api/jobs/${job.id}/text`, { text }))}>
            Submit text
          </Button>
        </Space>
      )}
    </Card>
  );
}
