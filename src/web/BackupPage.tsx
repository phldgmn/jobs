import { useState } from "react";
import { Alert, Button, Card, Popconfirm, Space, Typography, Upload } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { errMessage, send } from "./api";

export function BackupPage() {
  const [file, setFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [backing, setBacking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const busy = backing || restoring;

  // fetch instead of a plain link so the button stays disabled until the snapshot is complete.
  const download = () => {
    setBacking(true);
    setError(null);
    fetch("/api/backup")
      .then(res => {
        if (!res.ok) throw new Error(res.statusText);
        return res.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `jobs-${new Date().toISOString().slice(0, 10)}.db`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })
      .catch(e => setError(errMessage(e)))
      .finally(() => setBacking(false));
  };

  const restore = () => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setRestoring(true);
    setError(null);
    setDone(false);
    send<{ ok: true }>("POST", "/api/restore", { body: form })
      .then(() => {
        setFile(null);
        setDone(true);
      })
      .catch(e => setError(errMessage(e)))
      .finally(() => setRestoring(false));
  };

  return (
    <Card title="Backup and restore">
      {error && <Alert type="error" title={error} showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16 }} />}
      {done && (
        <Alert type="success" title="Restore complete" showIcon closable onClose={() => setDone(false)} style={{ marginBottom: 16 }} />
      )}
      <Space orientation="vertical" size="large" style={{ width: "100%" }}>
        <div>
          <Typography.Title level={5}>Backup</Typography.Title>
          <Typography.Paragraph type="secondary">
            Downloads one SQLite file with all jobs, materials, profile, settings and AI task queues.
          </Typography.Paragraph>
          <Button icon={<DownloadOutlined />} onClick={download} loading={backing} disabled={busy}>
            Download backup
          </Button>
        </div>
        <div>
          <Typography.Title level={5}>Restore</Typography.Title>
          <Typography.Paragraph type="secondary">
            Replaces all current data with the backup file. This cannot be undone; download a backup first.
          </Typography.Paragraph>
          <Space>
            <Upload
              accept=".db,.sqlite,.sqlite3"
              maxCount={1}
              showUploadList={false}
              disabled={busy}
              beforeUpload={f => {
                setFile(f);
                return false; // sent only after the user confirms
              }}
            >
              <Button icon={<UploadOutlined />}>Choose backup file</Button>
            </Upload>
            {file && (
              <Popconfirm title="Replace all current data with this backup?" okText="Restore" okButtonProps={{ danger: true }} onConfirm={restore}>
                <Button danger loading={restoring} disabled={busy}>
                  Restore {file.name}
                </Button>
              </Popconfirm>
            )}
          </Space>
        </div>
      </Space>
    </Card>
  );
}
