export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Keys for pasted text / uploaded files; not URLs, so never rendered as links.
export const isContentKey = (url: string): boolean => url.startsWith("text:") || url.startsWith("file:");

export async function send<T>(method: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, method });
  if (!res.ok) {
    const err: { error?: string } = await res.json().catch(() => ({}));
    throw new Error(err.error ?? res.statusText);
  }
  // trusted: same-origin API; server validates every response against its schema
  const data: T = await res.json();
  return data;
}

export function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  return send<T>(
    method,
    path,
    body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
}
