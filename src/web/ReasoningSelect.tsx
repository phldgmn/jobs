import { useEffect, useState } from "react";
import { AutoComplete } from "antd";
import { req } from "./api";

type ReasoningState = { effort: string | null; env: string | null; override: string | null };

// Common levels across OpenAI-compatible providers; the model's own list is not exposed by /models, so any typed value is accepted.
const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

// Header control: reasoning effort sent with every LLM call. Empty = "Default" (provider decides, nothing sent).
export function ReasoningSelect() {
  const [state, setState] = useState<ReasoningState | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    req<ReasoningState>("GET", "/api/reasoning")
      .then(s => {
        setState(s);
        setDraft(s.effort ?? "");
      })
      .catch(() => {});
  }, []);

  const save = async (value: string) => {
    setSaving(true);
    try {
      // Empty value clears the override so the env default (or provider default) applies again.
      const next = await req<ReasoningState>("PUT", "/api/reasoning", { effort: value.trim() || null });
      setState(next);
      setDraft(next.effort ?? "");
    } finally {
      setSaving(false);
    }
  };

  const options = [
    { value: "", label: "Default" },
    ...LEVELS.map(l => ({
      value: l,
      label: state?.env === l && state.override === null ? `${l} (env default)` : l,
    })),
  ];

  return (
    <AutoComplete
      value={draft}
      options={options}
      disabled={saving || !state}
      placeholder="Reasoning effort"
      style={{ width: 170 }}
      filterOption={(input, opt) => String(opt?.value ?? "").toLowerCase().includes(input.toLowerCase())}
      onChange={setDraft}
      onSelect={v => save(String(v))}
      onBlur={() => draft.trim() !== (state?.effort ?? "") && save(draft)}
      onKeyDown={e => e.key === "Enter" && save(draft)}
    />
  );
}
