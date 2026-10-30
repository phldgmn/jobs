import { useEffect, useState } from "react";
import { Alert, App as AntApp, Button, Card, Collapse, DatePicker, Descriptions, Dropdown, Form, Input, InputNumber, List, Select, Slider, Space, Switch, Tooltip, Typography, Upload, type UploadFile } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { CheckOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, EllipsisOutlined, ReloadOutlined, StopOutlined, UploadOutlined } from "@ant-design/icons";
import { errMessage, isContentKey, req, send } from "./api";
import { applyFilters, FIT_PARTIAL, FIT_STRONG, type Filters } from "./filter";
import { loadFilters, saveFilters } from "./filterStorage";
import { relativeDeadline } from "./relativeDate";
import { useJobs } from "./useJobs";
import type { Job, JobData } from "../schemas";

const remoteOptions: { value: Filters["remote"]; label: string }[] = [
  { value: "any", label: "Any remote" },
  { value: "full", label: "Full remote" },
  { value: "mostly", label: "Mostly remote" },
  { value: "partly", label: "Hybrid" },
  { value: "none", label: "On-site" },
  { value: "unknown", label: "Unknown" },
];

const visibilityOptions: { value: Filters["visibility"]; label: string }[] = [
  { value: "applicable", label: "Still applicable" },
  { value: "expired", label: "Expired" },
  { value: "all", label: "All" },
];

const jobsSortOptions: { value: Filters["sort"]; label: string }[] = [
  { value: "deadline_asc", label: "Deadline ↑" },
  { value: "deadline_desc", label: "Deadline ↓" },
  { value: "added_desc", label: "Newest added" },
  { value: "company_asc", label: "Company A–Z" },
  { value: "fit_desc", label: "Fit ↓" },
  { value: "fit_asc", label: "Fit ↑" },
];

const appliedSortOptions: { value: Filters["sort"]; label: string }[] = [
  { value: "applied_desc", label: "Applied at ↓" },
  { value: "applied_asc", label: "Applied at ↑" },
  { value: "company_asc", label: "Company A–Z" },
  { value: "fit_desc", label: "Fit ↓" },
  { value: "fit_asc", label: "Fit ↑" },
];

// `applied` selects the scope: the general list shows only not-applied jobs, the Applied page only applied ones.
export function JobsPage({ applied = false }: { applied?: boolean }) {
  const { jobs: all, error, setError, reload } = useJobs();
  const jobs = all.filter(j => Boolean(j.applied_at) === applied);
  const [filters, setFilters] = useState<Filters>(loadFilters);

  // Sort is shared storage: a value from the other page's list falls back to that page's first option.
  const sortOptions = applied ? appliedSortOptions : jobsSortOptions;
  const sort = sortOptions.some(o => o.value === filters.sort) ? filters.sort : sortOptions[0].value;

  // Persist on every change so the last-used filters and sort apply on the next visit.
  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  const update = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }));

  // Applied page offers only search and sort, so the other filters must not hide applied jobs.
  const effective: Filters = applied ? { ...filters, sort, remote: "any", visibility: "all", minFit: 0 } : { ...filters, sort };

  const parsed = jobs.filter(j => j.data !== null);
  const today = new Date().toLocaleDateString("en-CA");
  const visible = applyFilters(jobs, effective, today);

  // Batch actions apply to the currently filtered list, not all jobs.
  const batch = (action: "reparse" | "evaluate") =>
    req<{ queued: number }>("POST", "/api/jobs/batch", { ids: visible.map(j => j.id), action })
      .then(reload)
      .catch(e => setError(errMessage(e)));

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      {error && <Alert type="error" title={error} showIcon closable onClose={() => setError(null)} />}

      <Card
        title={
          <Space size="middle">
            {applied ? "Applied" : "Jobs"}
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              {visible.length} of {parsed.length} jobs
            </Typography.Text>
          </Space>
        }
        extra={
          <Space>
            <Input.Search
              allowClear
              placeholder="Search"
              value={filters.q}
              onChange={e => update({ q: e.target.value })}
              style={{ width: 200 }}
            />
            {!applied && (
              <>
                <Select
                  aria-label="Remote"
                  value={filters.remote}
                  onChange={v => update({ remote: v })}
                  options={remoteOptions}
                  style={{ width: 150 }}
                />
                <Select
                  aria-label="Visibility"
                  value={filters.visibility}
                  onChange={v => update({ visibility: v })}
                  options={visibilityOptions}
                  style={{ width: 150 }}
                />
                <Slider
                  aria-label="Minimum fit"
                  min={0}
                  max={100}
                  value={filters.minFit}
                  onChange={v => update({ minFit: v })}
                  tooltip={{ formatter: v => (v === 0 ? "Any" : `≥ ${v}`) }}
                  style={{ width: 120 }}
                />
              </>
            )}
            <Select
              aria-label="Sort"
              value={sort}
              onChange={v => update({ sort: v })}
              options={sortOptions}
              style={{ width: 180 }}
            />
            {!applied && (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    { key: "reparse", label: `Re-parse ${visible.length}`, disabled: visible.length === 0 },
                    { key: "evaluate", label: `Re-evaluate ${visible.length}`, disabled: visible.length === 0 },
                  ],
                  onClick: ({ key }) => batch(key as "reparse" | "evaluate"),
                }}
              >
                <Button type="text" icon={<EllipsisOutlined />} aria-label="Actions" />
              </Dropdown>
            )}
          </Space>
        }
      >
        <Collapse
          items={visible.map(j => ({
            key: String(j.id),
            label: <JobSummary job={j} today={today} />,
            children: <JobBody job={j} today={today} onChange={reload} setError={setError} />,
          }))}
        />
      </Card>
    </Space>
  );
}

// Fixed-width score badge at the very start of the heading. "–" until a job has been evaluated.
function FitBadge({ score }: { score: number | null }) {
  const color = score === null ? "#bfbfbf" : score >= FIT_STRONG ? "#389e0d" : score >= FIT_PARTIAL ? "#d48806" : "#cf1322";
  return (
    <span
      title={score === null ? "Not scored yet" : "Fit score (0–100)"}
      style={{ display: "inline-block", width: 40, textAlign: "center", fontWeight: 700, fontSize: 16, color, flexShrink: 0 }}
    >
      {score ?? "–"}
    </span>
  );
}

function JobSummary({ job, today }: { job: Job; today: string }) {
  const d: JobData | null = job.data;
  if (!d) return null;
  const past = d.expired || (d.deadline !== null && d.deadline < today);
  const company = [d.company, d.location].filter(Boolean).join(", ") || "—";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
      <FitBadge score={job.suitability?.score ?? null} />
      <strong>{d.title}</strong>
      <Typography.Text type="secondary">{company}</Typography.Text>
      <div style={{ marginLeft: "auto", paddingLeft: 16, whiteSpace: "nowrap" }}>
        <Deadline data={d} today={today} past={past} />
      </div>
    </div>
  );
}

// Relative deadline; hover shows the actual date.
function Deadline({ data: d, today, past }: { data: JobData; today: string; past: boolean }) {
  const type = past ? "secondary" : undefined;
  if (d.expired) return <Typography.Text type={type}>expired</Typography.Text>;
  if (d.deadline === null) return <Typography.Text type={type}></Typography.Text>;
  return (
    <Tooltip title={d.deadline}>
      <Typography.Text type={type}>{relativeDeadline(d.deadline, today)}</Typography.Text>
    </Tooltip>
  );
}

// Materials: upload any number of files; list with view, download and delete.
const INLINE_MIME = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;
// View opens inline only for types the server allows inline; download always works.
function MaterialsSection({ job, onChange, setError }: { job: Job; onChange: () => void; setError: (s: string | null) => void }) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const upload = async () => {
    const form = new FormData();
    for (const f of files) form.append("file", f.originFileObj as File);
    setUploading(true);
    try {
      await send("POST", `/api/jobs/${job.id}/materials`, { body: form });
      setFiles([]);
      onChange();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const remove = (id: number) =>
    req("DELETE", `/api/materials/${id}`)
      .then(onChange)
      .catch(e => setError(errMessage(e)));

  return (
    <div>
      <Typography.Title level={5}>Application materials</Typography.Title>
      {job.materials.length > 0 && (
        <List
          size="small"
          bordered
          dataSource={job.materials}
          renderItem={m => (
            <List.Item
              actions={[
                // Mirrors the server's INLINE_MIME; other types would just download.
                ...(INLINE_MIME.test(m.mime)
                  ? [
                      <a key="view" href={`/api/materials/${m.id}`} target="_blank" rel="noreferrer">
                        View
                      </a>,
                    ]
                  : []),
                <a key="dl" href={`/api/materials/${m.id}`} download={m.name}>
                  <DownloadOutlined /> Download
                </a>,
                <Button key="del" type="link" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(m.id)} />,
              ]}
            >
              {m.name} <Typography.Text type="secondary">({Math.ceil(m.size / 1024)} KB)</Typography.Text>
            </List.Item>
          )}
        />
      )}
      <Space orientation="vertical" style={{ width: "100%", marginTop: 12 }}>
        <Upload.Dragger multiple fileList={files} beforeUpload={() => false} onChange={({ fileList }) => setFiles(fileList)}>
          <p>Drop files here (CV, cover letter, ...), or click to choose</p>
        </Upload.Dragger>
        <Button icon={<UploadOutlined />} onClick={upload} loading={uploading} disabled={files.length === 0}>
          {files.length === 0 ? "Upload" : `Upload ${files.length} file${files.length === 1 ? "" : "s"}`}
        </Button>
      </Space>
    </div>
  );
}

// Form values: lists are edited one entry per line; deadline is a dayjs from DatePicker.
type EditValues = Omit<JobData, "must_haves" | "nice_to_haves" | "deadline"> & {
  deadline: Dayjs | null;
  must_haves: string;
  nice_to_haves: string;
};

const toLines = (xs: string[]) => xs.join("\n");
const fromLines = (s: string | undefined) =>
  (s ?? "")
    .split("\n")
    .map(x => x.trim())
    .filter(x => x.length > 0);

const fmtLangs = (xs: string[]) => (xs.length ? xs.join(", ") : "—");

function JobBody({
  job,
  today,
  onChange,
  setError,
}: {
  job: Job;
  today: string;
  onChange: () => void;
  setError: (s: string | null) => void;
}) {
  const { modal } = AntApp.useApp();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<EditValues>();
  const [saving, setSaving] = useState(false);
  const d = job.data;
  if (!d) return null;

  const reparse = () =>
    req("POST", `/api/jobs/${job.id}/reparse`)
      .then(onChange)
      .catch(e => setError(errMessage(e)));

  const reevaluate = () =>
    req("POST", `/api/jobs/${job.id}/evaluate`)
      .then(onChange)
      .catch(e => setError(errMessage(e)));

  const toggleExpired = () =>
    req("POST", `/api/jobs/${job.id}/expired`, { expired: !d.expired })
      .then(onChange)
      .catch(e => setError(errMessage(e)));

  const toggleApplied = () =>
    req("POST", `/api/jobs/${job.id}/applied`, { applied: job.applied_at === null })
      .then(onChange)
      .catch(e => setError(errMessage(e)));

  const startEdit = () => {
    form.setFieldsValue({
      ...d,
      deadline: d.deadline ? dayjs(d.deadline) : null,
      must_haves: toLines(d.must_haves),
      nice_to_haves: toLines(d.nice_to_haves),
    });
    setEditing(true);
  };

  const save = async () => {
    const v = await form.validateFields();
    const payload: JobData = {
      ...d,
      ...v,
      deadline: v.deadline ? v.deadline.format("YYYY-MM-DD") : null,
      must_haves: fromLines(v.must_haves),
      nice_to_haves: fromLines(v.nice_to_haves),
    };
    setSaving(true);
    try {
      await req("PUT", `/api/jobs/${job.id}/data`, payload);
      setEditing(false);
      onChange();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    modal.confirm({
      title: "Delete this job?",
      okText: "Delete",
      okType: "danger",
      onOk: () =>
        req("DELETE", `/api/jobs/${job.id}`)
          .then(onChange)
          .catch(e => setError(errMessage(e))),
    });

  const past = d.expired || (d.deadline !== null && d.deadline < today);
  const remoteLabel = remoteOptions.find(o => o.value === d.remote)?.label ?? d.remote;
  const language = d.translated ? `${d.language} (translated)` : d.language;
  const editRemoteOptions = remoteOptions.filter(o => o.value !== "any");

  // Same table for read-only and edit: each cell is either the value or the matching form control.
  const rows = [
    {
      key: "company",
      label: "Company",
      children: editing ? (
        <Form.Item name="company" noStyle>
          <Input />
        </Form.Item>
      ) : (
        (d.company ?? "—")
      ),
    },
    {
      key: "location",
      label: "Location",
      children: editing ? (
        <Form.Item name="location" noStyle>
          <Input />
        </Form.Item>
      ) : (
        (d.location ?? "—")
      ),
    },
    {
      key: "remote",
      label: "Remote",
      children: editing ? (
        <Form.Item name="remote" noStyle>
          <Select options={editRemoteOptions} style={{ width: "100%" }} />
        </Form.Item>
      ) : (
        remoteLabel
      ),
    },
    {
      key: "salary",
      label: "Salary (as stated)",
      children: editing ? (
        <Form.Item name="salary" noStyle>
          <Input />
        </Form.Item>
      ) : (
        (d.salary ?? "—")
      ),
    },
    {
      key: "salary_min",
      label: "Salary min",
      children: editing ? (
        <Form.Item name="salary_min" noStyle>
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
      ) : (
        (d.salary_min?.toString() ?? "—")
      ),
    },
    {
      key: "salary_max",
      label: "Salary max",
      children: editing ? (
        <Form.Item name="salary_max" noStyle>
          <InputNumber style={{ width: "100%" }} />
        </Form.Item>
      ) : (
        (d.salary_max?.toString() ?? "—")
      ),
    },
    {
      key: "salary_currency",
      label: "Currency (ISO 4217)",
      children: editing ? (
        <Form.Item name="salary_currency" noStyle>
          <Input />
        </Form.Item>
      ) : (
        (d.salary_currency ?? "—")
      ),
    },
    {
      key: "deadline",
      label: "Deadline",
      children: editing ? (
        <Form.Item name="deadline" noStyle>
          <DatePicker format="YYYY-MM-DD" allowClear style={{ width: "100%" }} />
        </Form.Item>
      ) : (
        <Deadline data={d} today={today} past={past} />
      ),
    },
    {
      key: "expired",
      label: "Expired",
      children: editing ? (
        <Form.Item name="expired" valuePropName="checked" noStyle>
          <Switch />
        </Form.Item>
      ) : (
        (d.expired ? "Yes" : "No")
      ),
    },
    { key: "language", label: "Language", children: language },
    {
      key: "required_spoken",
      label: "Required spoken",
      children: editing ? (
        <Form.Item name="required_spoken_languages" noStyle>
          <Select mode="tags" placeholder="ISO 639-1 codes, e.g. de" style={{ width: "100%" }} />
        </Form.Item>
      ) : (
        fmtLangs(d.required_spoken_languages)
      ),
    },
    {
      key: "required_written",
      label: "Required written",
      children: editing ? (
        <Form.Item name="required_written_languages" noStyle>
          <Select mode="tags" placeholder="ISO 639-1 codes, e.g. en" style={{ width: "100%" }} />
        </Form.Item>
      ) : (
        fmtLangs(d.required_written_languages)
      ),
    },
    {
      key: "url",
      label: "Original",
      children: (
        isContentKey(job.url) ? (
          "Pasted or uploaded content"
        ) : (
          <a href={job.url} target="_blank" rel="noreferrer">
            {job.url}
          </a>
        )
      ),
    },
  ];

  return (
    <Form<EditValues> form={form} layout="vertical" disabled={saving}>
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={rows} />

        <div>
          <Typography.Title level={5}>Job description</Typography.Title>
          {editing ? (
            <Form.Item name="description" noStyle>
              <Input.TextArea autoSize={{ minRows: 4 }} />
            </Form.Item>
          ) : (
            <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{d.description}</Typography.Paragraph>
          )}
        </div>

        {(editing || d.company_description) && (
          <div>
            <Typography.Title level={5}>Company description</Typography.Title>
            {editing ? (
              <Form.Item name="company_description" noStyle>
                <Input.TextArea autoSize={{ minRows: 2 }} />
              </Form.Item>
            ) : (
              <Typography.Paragraph>{d.company_description}</Typography.Paragraph>
            )}
          </div>
        )}

        {(editing || d.must_haves.length > 0) && (
          <div>
            <Typography.Title level={5}>Must-haves</Typography.Title>
            {editing ? (
              <Form.Item name="must_haves" noStyle>
                <Input.TextArea autoSize={{ minRows: 3 }} placeholder="One per line" />
              </Form.Item>
            ) : (
              <ul>
                {d.must_haves.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(editing || d.nice_to_haves.length > 0) && (
          <div>
            <Typography.Title level={5}>Nice-to-haves</Typography.Title>
            {editing ? (
              <Form.Item name="nice_to_haves" noStyle>
                <Input.TextArea autoSize={{ minRows: 3 }} placeholder="One per line" />
              </Form.Item>
            ) : (
              <ul>
                {d.nice_to_haves.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(job.suitability || job.suitability_error || job.evaluating) && (
          <div>
            <Typography.Title level={5}>AI suitability</Typography.Title>
            {job.evaluating && <Typography.Text type="secondary">Evaluating…</Typography.Text>}
            {job.suitability_error && !job.evaluating && <Alert type="error" title={job.suitability_error} showIcon />}
            {job.suitability && (
              <Space orientation="vertical" size="small" style={{ width: "100%" }}>
                <Typography.Text strong>Strengths</Typography.Text>
                <ul>
                  {job.suitability.strengths.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
                <Typography.Text strong>Issues</Typography.Text>
                <ul>
                  {job.suitability.issues.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </Space>
            )}
          </div>
        )}

        {editing ? (
          <Space>
            <Button type="primary" loading={saving} onClick={save}>
              Save
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </Space>
        ) : (
          <Space>
            <Button icon={<CheckOutlined />} onClick={toggleApplied}>
              {job.applied_at ? "Mark not applied" : "Mark applied"}
            </Button>
            <Button icon={<EditOutlined />} onClick={startEdit}>
              Edit
            </Button>
            <Button icon={<ReloadOutlined />} onClick={reparse}>
              Reparse
            </Button>
            <Button icon={<ReloadOutlined />} loading={job.evaluating} onClick={reevaluate}>
              Re-evaluate
            </Button>
            <Button icon={<StopOutlined />} onClick={toggleExpired}>
              {d.expired ? "Mark as open" : "Mark as expired"}
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={remove}>
              Delete
            </Button>
          </Space>
        )}

        {!editing && <MaterialsSection job={job} onChange={onChange} setError={setError} />}
      </Space>
    </Form>
  );
}
