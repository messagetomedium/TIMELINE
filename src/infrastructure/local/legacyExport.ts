import { backupSchema } from "../../application/workspace/model";
import { defaultPreferences } from "../../application/workspace/model";
/** Native readonly transactions: do not run Dexie initialization or a V1 migration. */
export async function hasLegacyData() {
  return (await indexedDB.databases()).some(
    (d) => d.name === "timeline-workspace",
  );
}
export async function exportLegacy(): Promise<string> {
  if (!(await hasLegacyData())) throw Error("Старая база не найдена");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("timeline-workspace");
    request.onerror = () => {
      reject(request.error ?? new Error("Legacy export failed"));
    };
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      reject(Error("Старая база недоступна"));
    };
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(["documents", "preferences"], "readonly");
        const docs = tx.objectStore("documents").getAll(),
          prefs = tx.objectStore("preferences").getAll();
        tx.oncomplete = () => {
          try {
            const rows = prefs.result as { key: string; value: unknown }[];
            const documents = (
              docs.result as { id: string; value: Record<string, unknown> }[]
            ).map((r) => ({
              ...r.value,
              viewPreferences:
                rows.find((p) => p.key === `editor:${r.id}`)?.value ??
                r.value.viewPreferences,
            }));
            resolve(
              JSON.stringify(
                backupSchema.parse({
                  format: "timeline-backup",
                  version: 1,
                  exportedAt: new Date().toISOString(),
                  documents,
                  preferences:
                    rows.find((p) => p.key === "workspace")?.value ??
                    defaultPreferences,
                }),
                null,
                2,
              ),
            );
          } catch (e) {
            reject(e instanceof Error ? e : new Error("Legacy export failed"));
          } finally {
            db.close();
          }
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("Legacy read failed"));
        };
      } catch (e) {
        db.close();
        reject(e instanceof Error ? e : new Error("Legacy export failed"));
      }
    };
  });
}
