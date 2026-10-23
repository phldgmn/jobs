import { useCallback, useEffect, useState } from "react";
import { errMessage, req } from "./api";
import type { Job } from "../schemas";

// Loads all jobs and refetches every 2s while any job is still pending.
export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    req<Job[]>("GET", "/api/jobs")
      .then(setJobs)
      .catch(e => setError(errMessage(e)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const anyPending = jobs.some(j => j.status === "pending" || j.evaluating);
  useEffect(() => {
    if (!anyPending) return;
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [anyPending, reload]);

  return { jobs, error, setError, reload };
}
