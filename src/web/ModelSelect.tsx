import { useEffect, useState } from "react";
import { AutoComplete, Tooltip } from "antd";
import { req } from "./api";

type ModelState = { model: string; env: string; override: string | null };

// Header control: picks the LLM model. Fetched list is a suggestion; any typed name is accepted.
// AutoComplete (not Select) because antd Select has no public single-value free-text mode.
export function ModelSelect() {
  const [state, setState] = useState<ModelState | null>(null);
  const [draft, setDraft] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    req<ModelState>("GET", "/api/model").then(s => {
      setState(s);
      setDraft(s.model);
    }).catch(() => {});
    req<{ models: string[] }>("GET", "/api/models")
      .then(r => setModels(r.models))
      .catch(e => setFetchError(e instanceof Error ? e.message : String(e)));
  }, []);

  const save = async (value: string) => {
    setSaving(true);
    try {
      // Empty value clears the override so the LLM_MODEL env default applies again.
      const next = await req<ModelState>("PUT", "/api/model", { model: value.trim() || null });
      setState(next);
      setDraft(next.model);
    } finally {
      setSaving(false);
    }
  };

  const options = [...new Set([...(state ? [state.model] : []), ...models])].map(m => ({
    value: m,
    label: m === state?.env && state.override === null ? `${m} (env default)` : m,
  }));

  const input = (
    <AutoComplete
      value={draft}
      options={options}
      disabled={saving || !state}
      placeholder="Model name"
      allowClear
      style={{ width: 300 }}
      filterOption={(input, opt) => String(opt?.value ?? "").toLowerCase().includes(input.toLowerCase())}
      onChange={setDraft}
      onSelect={v => save(String(v))}
      onBlur={() => draft.trim() !== (state?.model ?? "") && save(draft)}
      onClear={() => save("")}
      onKeyDown={e => e.key === "Enter" && save(draft)}
    />
  );

  return fetchError ? (
    <Tooltip title={`Model list unavailable: ${fetchError}. Type a model name.`}>{input}</Tooltip>
  ) : (
    input
  );
}
