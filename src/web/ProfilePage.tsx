import { useEffect, useState } from "react";
import { Alert, App as AntApp, Button, Card, Collapse, Input, Space, Tabs, Typography, Upload } from "antd";
import { CopyOutlined, UploadOutlined } from "@ant-design/icons";
import { errMessage, req, send } from "./api";
import { ProfileOverview } from "./ProfileOverview";
import { ProfileForm } from "./ProfileForm";
import { Profile } from "../schemas";

// The server is the source of truth: every save returns the normalized profile.
// Edit, Import CV and JSON/YAML all write through here.
export function ProfilePage() {
  const { message } = AntApp.useApp();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("overview");

  // Shared save path. `source` says which tab produced the data, for the message.
  const persist = async (body: string, source: string) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await req<Profile>("PUT", "/api/profile", { text: body });
      setProfile(saved);
      setText(JSON.stringify(saved, null, 2));
      message.success(`Profile saved (${source})`);
      return true;
    } catch (e) {
      setError(errMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    req<Profile>("GET", "/api/profile")
      .then(p => {
        setProfile(p);
        setText(JSON.stringify(p, null, 2));
      })
      .catch(e => setError(errMessage(e)));
  }, []);

  if (!profile) return <Alert type={error ? "error" : "info"} title={error ?? "Loading profile…"} showIcon />;

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      {error && <Alert type="error" title={error} showIcon closable onClose={() => setError(null)} />}
      {status && <Alert type="info" title={status} showIcon closable onClose={() => setStatus(null)} />}

      <Card>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "overview",
              label: "Overview",
              children: <ProfileOverview p={profile} />,
            },
            {
              key: "edit",
              label: "Edit",
              children: <ProfileForm initial={profile} onSave={body => persist(body, "form")} />,
            },
            {
              key: "import",
              label: "Import CV",
              children: (
                <ImportCv
                  onExtracted={p => {
                    setText(JSON.stringify(p, null, 2));
                    setProfile(p);
                    setStatus("Extracted. Review in Edit or JSON / YAML, then save.");
                    setTab("edit");
                  }}
                  setStatus={setStatus}
                  setError={setError}
                />
              ),
            },
            {
              key: "raw",
              label: "JSON / YAML",
              children: (
                <RawEditor
                  text={text}
                  setText={setText}
                  saving={saving}
                  onSave={() => persist(text, "JSON/YAML")}
                  setError={setError}
                  setStatus={setStatus}
                />
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}

function ImportCv({
  onExtracted,
  setStatus,
  setError,
}: {
  onExtracted: (p: Profile) => void;
  setStatus: (s: string | null) => void;
  setError: (s: string | null) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [pasteCv, setPasteCv] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // CV extraction is a slow LLM call; show it is still running.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const extract = async () => {
    setBusy(true);
    setError(null);
    setStatus(`Extracting CV with AI. This can take a few minutes…`);
    const fd = new FormData();
    if (file) fd.append("file", file);
    else fd.append("text", pasteCv);
    try {
      const p = await send<Profile>("POST", "/api/profile/cv", { body: fd });
      onExtracted(Profile.parse(p));
    } catch (e) {
      setError(errMessage(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        Upload a PDF, TXT or MD CV. The AI drafts a profile; nothing is saved until you review and save it.
      </Typography.Paragraph>
      <Upload
        accept=".pdf,.txt,.md"
        maxCount={1}
        beforeUpload={f => {
          setFile(f);
          return false; // keep file in state; we upload manually
        }}
        onRemove={() => setFile(null)}
      >
        <Button icon={<UploadOutlined />}>Select CV file</Button>
      </Upload>
      <Input.TextArea
        rows={6}
        placeholder="Or paste CV text"
        value={pasteCv}
        onChange={e => setPasteCv(e.target.value)}
      />
      <Button type="primary" loading={busy} disabled={!file && !pasteCv.trim()} onClick={extract}>
        {busy ? `Extracting… ${elapsed}s` : "Extract with AI"}
      </Button>
    </Space>
  );
}

function RawEditor({
  text,
  setText,
  saving,
  onSave,
  setError,
  setStatus,
}: {
  text: string;
  setText: (s: string) => void;
  saving: boolean;
  onSave: () => void;
  setError: (s: string | null) => void;
  setStatus: (s: string | null) => void;
}) {
  const [prompt, setPrompt] = useState<string | null>(null);

  const copyPrompt = async () => {
    setError(null);
    try {
      const p = await (await fetch("/api/profile/prompt")).text();
      setPrompt(p);
      await navigator.clipboard.writeText(p);
      setStatus("Prompt copied. Paste it into your external agent with your CV attached.");
    } catch (e) {
      setError(errMessage(e));
    }
  };

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Input.TextArea rows={24} value={text} onChange={e => setText(e.target.value)} style={{ fontFamily: "monospace" }} />
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        JSON or YAML accepted.
      </Typography.Paragraph>
      <Space wrap>
        <Button type="primary" onClick={onSave} loading={saving}>
          Save
        </Button>
        <Button icon={<CopyOutlined />} onClick={copyPrompt}>
          Copy prompt for external agent
        </Button>
      </Space>
      {prompt && (
        <Collapse items={[{ key: "p", label: "Prompt", children: <pre style={{ whiteSpace: "pre-wrap" }}>{prompt}</pre> }]} />
      )}
    </Space>
  );
}
