import { z } from "zod";
import { snapshotSchema } from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
const entrySchema = z.strictObject({
  before: snapshotSchema,
  after: snapshotSchema,
});
export const localHistorySchema = z.strictObject({
  version: z.literal(1),
  projectId: z.string(),
  workspaceId: z.string(),
  revision: z.number().int().nonnegative(),
  fingerprint: z.string(),
  undo: z.array(entrySchema),
  redo: z.array(entrySchema),
});
export type LocalHistory = z.infer<typeof localHistorySchema>;
/** Opaque payload permits preserving an incompatible row without interpreting or destroying it. */
export interface StoredHistory {
  key: string;
  token: string;
  value: unknown;
}
export const historyKey = (id: string) => `current:${id}`;
export function fingerprint(d: Snapshot) {
  return JSON.stringify(d, (key, value: unknown) =>
    key === "viewPreferences" ? undefined : value,
  );
}
export function semantic(d: Snapshot) {
  return JSON.stringify(d, (key, value: unknown) =>
    key === "viewPreferences" || key === "revision" || key === "updatedAt"
      ? undefined
      : value,
  );
}
export function readHistory(
  row: StoredHistory | null,
  d: Snapshot,
): LocalHistory | null {
  if (!row) return null;
  const parsed = localHistorySchema.safeParse(row.value);
  if (!parsed.success) return null;
  const h = parsed.data;
  if (
    h.projectId !== d.project.id ||
    h.workspaceId !== d.project.workspaceId ||
    h.revision !== d.project.revision ||
    h.fingerprint !== fingerprint(d)
  )
    return null;
  const entries = [...h.undo, ...h.redo];
  if (
    entries.some((e) =>
      [e.before, e.after].some(
        (v) =>
          v.project.id !== d.project.id ||
          v.project.workspaceId !== d.project.workspaceId,
      ),
    )
  )
    return null;
  const chain = [...h.undo, ...[...h.redo].reverse()];
  if (
    chain.some(
      (e, i) =>
        i > 0 &&
        semantic(chain[i - 1]?.after ?? e.before) !== semantic(e.before),
    )
  )
    return null;
  if (h.undo.length && semantic(h.undo.at(-1)?.after ?? d) !== semantic(d))
    return null;
  if (h.redo.length && semantic(h.redo.at(-1)?.before ?? d) !== semantic(d))
    return null;
  return h;
}
export function makeHistory(
  d: Snapshot,
  undo: LocalHistory["undo"],
  redo: LocalHistory["redo"],
): LocalHistory {
  return {
    version: 1,
    projectId: d.project.id,
    workspaceId: d.project.workspaceId,
    revision: d.project.revision,
    fingerprint: fingerprint(d),
    undo,
    redo,
  };
}
export const HISTORY_CONFLICT =
  "Локальная история несовместима с текущей ревизией (возможно, проект изменён в другой вкладке). Данные не перезаписаны. Новое действие начнёт отдельную историю, прежняя сохранится в базе.";
