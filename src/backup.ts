import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "./db";

// Insert order satisfies foreign keys (jobs before materials and tasks); deletes run in reverse.
const TABLES = ["jobs", "materials", "failed_tasks", "active_tasks", "profile", "settings"] as const;

// VACUUM INTO writes a consistent snapshot of the live WAL database to a new file.
export function backupDatabase(): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "jobs-backup-"));
  try {
    const file = join(dir, "backup.db");
    db.run("VACUUM INTO ?", [file]);
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Replaces all rows with those of the backup file. Copies only columns both sides share,
// so a backup from an older schema restores and newer columns keep their defaults.
// Throws on a non-SQLite file, a failed integrity check, or a file missing a table.
export function restoreDatabase(file: string) {
  db.run("ATTACH DATABASE ? AS backup", [file]);
  try {
    const check = db.query<{ quick_check: string }, []>("PRAGMA backup.quick_check").get();
    if (check?.quick_check !== "ok") throw new Error("Backup failed integrity check");
    const present = new Set(
      db.query<{ name: string }, []>("SELECT name FROM backup.sqlite_master WHERE type = 'table'").all().map(r => r.name),
    );
    const missing = TABLES.find(t => !present.has(t));
    if (missing) throw new Error(`Not a job tracker backup: missing table ${missing}`);

    const columns = (schema: "main" | "backup", table: string) =>
      db.query<{ name: string }, []>(`PRAGMA ${schema}.table_info(${table})`).all().map(c => c.name);

    db.transaction(() => {
      for (const t of [...TABLES].reverse()) db.run(`DELETE FROM main.${t}`);
      for (const t of TABLES) {
        const backupCols = new Set(columns("backup", t));
        const cols = columns("main", t).filter(c => backupCols.has(c)).join(", ");
        db.run(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM backup.${t}`);
      }
    })();
  } finally {
    db.run("DETACH DATABASE backup");
  }
}
