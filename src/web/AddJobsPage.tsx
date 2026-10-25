import { useState } from "react";
import { Alert, App as AntApp, Button, Card, Input, Space, Spin, Tabs, Typography, Upload, type UploadFile } from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { errMessage, isContentKey, req, send } from "./api";
import { useJobs } from "./useJobs";
import type { Job } from "../schemas";

type AddResult = { added: number[]; skipped: string[] };
type Mode = "urls" | "text" | "file";

export function AddJobsPage() {
  const { jobs, error, setError, reload } = useJobs();
  const [mode, setMode] = useState<Mode>("urls");
  const [urls, setUrls] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<AddResult | null>(null);

  const processing = jobs.filter(j => j.status !== "parsed");

  const canAdd = mode === "urls" ? urls.trim() !== "" : mode === "text" ? pastedText.trim() !== "" : files.length > 0;

  const add = async () => {
    setError(null);
    setAdding(true);
    try {
      let res: AddResult;
      if (mode === "urls") {
        res = await req<AddResult>("POST", "/api/jobs", { urls: urls.split("\n") });
        setUrls("");
      } else if (mode === "text") {
        res = await req<AddResult>("POST", "/api/jobs/text", { text: pastedText, url: sourceUrl });
        setPastedText("");
        setSourceUrl("");
      } else {
        const form = new FormData();
        form.append("file", files[0].originFileObj as File);
        if (sourceUrl.trim()) form.append("url", sourceUrl.trim());
        res = await send<AddResult>("POST", "/api/jobs/file", { body: form });
        setFiles([]);
        setSourceUrl("");
      }
      setAddResult(res);
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
          <Button type="primary" onClick={add} loading={adding} disabled={!canAdd}>
            Add
          </Button>
        }
      >
        <Tabs
          activeKey={mode}
          onChange={k => setMode(k as Mode)}
          items={[
            {
              key: "urls",
              label: "URLs",
              children: (
                <Input.TextArea
                  rows={4}
                  placeholder="One job URL per line"
                  value={urls}
                  onChange={e => setUrls(e.target.value)}
                />
              ),
            },
            {
              key: "text",
              label: "Text",
              children: (
                <Space orientation="vertical" style={{ width: "100%" }}>
                  <Input.TextArea
                    rows={6}
                    placeholder="Paste the job description"
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value)}
                  />
                  <Input
                    placeholder="Source URL (optional)"
                    value={sourceUrl}
                    onChange={e => setSourceUrl(e.target.value)}
                  />
                </Space>
              ),
            },
            {
              key: "file",
              label: "File",
              children: (
                <Space orientation="vertical" style={{ width: "100%" }}>
                  <Upload.Dragger
                    accept=".pdf,.html,.htm,text/html,application/pdf"
                    maxCount={1}
                    fileList={files}
                    beforeUpload={() => false}
                    onChange={({ fileList }) => setFiles(fileList)}
                  >
                    <p>Drop a PDF or HTML file here, or click to choose</p>
                  </Upload.Dragger>
                  <Input
                    placeholder="Source URL (optional)"
                    value={sourceUrl}
                    onChange={e => setSourceUrl(e.target.value)}
                  />
                </Space>
              ),
            },
          ]}
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
        {isContentKey(job.url) ? (
          job.url
        ) : (
          <a href={job.url} target="_blank" rel="noreferrer">
            {job.url}
          </a>
        )}
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
