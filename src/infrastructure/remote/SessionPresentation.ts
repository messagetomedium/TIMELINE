import { z } from "zod";
import { viewPreferencesSchema } from "../../domain/schema";
import type { ViewPreferences } from "../../domain";
import { normalizeView } from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
import { defaultPreferences, workspacePreferencesSchema } from "../../application/workspace/model";
import type { WorkspacePreferences } from "../../application/workspace/model";

export type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const tabStorage: TabStorage = {
  getItem: (key) => sessionStorage.getItem(key),
  setItem: (key, value) => { sessionStorage.setItem(key, value); },
  removeItem: (key) => { sessionStorage.removeItem(key); },
};
const savedView = z.strictObject({ version: z.literal(1), view: viewPreferencesSchema });
/** Presentation only. Never reads/writes content or another user's preferences. */
export class SessionPresentation {
  private views = new Map<string, ViewPreferences>();
  private preferences: WorkspacePreferences | undefined;
  private readonly prefix: string;
  constructor(userId: string, privateStorage: TabStorage) { this.prefix = `timeline-ui-v1:${encodeURIComponent(userId)}:`; this.storage = privateStorage; }
  private readonly storage: TabStorage;
  private read(key: string): unknown {
    try { const raw = this.storage.getItem(this.prefix + key); return raw ? JSON.parse(raw) as unknown : null; }
    catch { return null; } // An unavailable UI preference never blocks server content.
  }
  private write(key: string, value: unknown) {
    try { this.storage.setItem(this.prefix + key, JSON.stringify(value)); }
    catch { /* Keep the view in memory for this session, without claiming a server save. */ }
  }
  view(document: Snapshot) {
    const id = document.project.id;
    let view = this.views.get(id);
    if (!view) {
      const parsed = savedView.safeParse(this.read(id));
      // SQL view is a deprecated compatibility field, never the current UI source.
      view = parsed.success && parsed.data.view.projectId === id ? parsed.data.view : {
        projectId: id, gridStep: "1w", zoomPxPerDay: 14, cameraX: 48, cameraY: 0,
        showWeekends: true, expandedProcessIds: [], expandedAssigneeGroupIds: [], showPeoplePanel: true,
      };
    }
    const normalized = normalizeView(document, view);
    this.views.set(id, normalized);
    return normalized;
  }
  saveView(id: string, value: ViewPreferences) {
    const view = viewPreferencesSchema.parse(value);
    if (view.projectId !== id) throw Error("Вид принадлежит другому проекту");
    if (JSON.stringify(this.views.get(id)) === JSON.stringify(view)) return;
    this.views.set(id, view); this.write(id, { version: 1, view });
  }
  workspace() {
    if (!this.preferences) this.preferences = workspacePreferencesSchema.safeParse(this.read("workspace")).data ?? defaultPreferences;
    return this.preferences;
  }
  saveWorkspace(value: WorkspacePreferences) {
    const parsed = workspacePreferencesSchema.parse(value);
    this.preferences = parsed; this.write("workspace", parsed);
  }
}
