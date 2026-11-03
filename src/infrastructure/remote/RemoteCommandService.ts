import { z } from "zod";
import { envelopeSchema } from "../../domain/v2/commands";
import type { CommandEnvelope, ContentCommand } from "../../domain/v2/commands";
import { peopleEnvelopeSchema } from "../../domain/v2/people";
import type { PeopleEnvelope } from "../../domain/v2/people";
import { catalogSchema } from "../../domain/v2/peopleModel";
import { WORKSPACE_ID, snapshotSchema } from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
import { projectIdSchema } from "../../domain";
import type { ProjectId, ViewPreferences } from "../../domain";
import { defaultPreferences, workspacePreferencesSchema } from "../../application/workspace/model";
import type { WorkspacePreferences } from "../../application/workspace/model";
import { projectSummarySchema, emptyPortfolio } from "../../application/v2/portfolio";
import type { PortfolioCommand } from "../../application/v2/portfolio";
import { createProjectSchema, workspaceCommandSchema, viewSchema, commandResultSchema } from "../../application/v2/apiContracts";
import type { UIService, ServerRecovery, RecoveryState } from "../../application/v2/uiService";
import { v2BackupSchema } from "../../application/v2/backup";
import { ApiError, requestApi } from "./ApiClient";
import type { RequestApi } from "./ApiClient";

const tabStorage = {
  getItem: (key: string) => sessionStorage.getItem(key),
  setItem: (key: string, value: string) => { sessionStorage.setItem(key, value); },
  removeItem: (key: string) => { sessionStorage.removeItem(key); },
};
const pendingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), body: envelopeSchema }),
  z.object({ kind: z.literal("create"), body: createProjectSchema }),
  z.object({ kind: z.literal("workspace"), body: workspaceCommandSchema }),
  z.object({ kind: z.literal("people"), body: peopleEnvelopeSchema }),
  z.object({ kind: z.literal("view"), projectId: projectIdSchema, body: viewSchema }),
]);
type Pending = z.infer<typeof pendingSchema>;
const storedSchema = z.object({ pending: pendingSchema.nullable(), drafts: z.record(z.string(), z.string()) });
const workspaceSchema = z.object({ workspace: z.object({ id: z.literal(WORKSPACE_ID), revision: z.number().int().nonnegative() }), role: z.string() });
const pageSchema = z.object({ projects: z.array(projectSummarySchema), workspaceRevision: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable() });

/** One unacknowledged intent, never an offline write queue or a snapshot upload. */
export class RemoteCommandService implements UIService, ServerRecovery {
  private readonly api: RequestApi;
  private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  private readonly key: string;
  private pending: Pending | null = null;
  private listeners = new Set<() => void>();
  private state: RecoveryState = { pending: false, sending: false, message: "", intent: "", conflict: false, authRequired: false, drafts: {} };
  private drafts: Record<string, string> = {};
  private revision = 0;
  private documents: z.infer<typeof projectSummarySchema>[] = [];
  private ownRevisions = new Map<string, Map<number, number>>();
  private preferences: WorkspacePreferences = defaultPreferences;
  private views: Record<string, ViewPreferences> = {};
  constructor(userId: string, api = requestApi, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = tabStorage) {
    this.api = api; this.storage = storage; this.key = `timeline-api-draft-v1:${userId}`;
    try {
      const raw = storage.getItem(this.key);
      if (raw) {
        const restored = storedSchema.parse(JSON.parse(raw) as unknown);
        this.pending = restored.pending;
        this.drafts = restored.drafts;
        this.state = { ...this.state, drafts: restored.drafts, pending: !!this.pending,
          intent: this.pending ? JSON.stringify(this.pending.body, null, 2) : "",
          message: this.pending ? "Есть неподтверждённая правка. Проверьте её и повторите исходный запрос." : Object.keys(this.drafts).length ? "Восстановлен незавершённый ввод из этой вкладки." : "" };
      }
    } catch {
      this.state = { ...this.state, pending: true, message: "Черновик вкладки недоступен или повреждён. Сохранение заблокировано. Скопируйте доступный ввод и явно удалите черновик перед продолжением." };
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  private update(value: Partial<RecoveryState>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => { listener(); });
  }
  private persist() {
    // Fail before dispatch if the recovery intent cannot survive a reload.
    try {
      if (!this.pending && !Object.keys(this.drafts).length) { this.storage.removeItem(this.key); return; }
      this.storage.setItem(this.key, JSON.stringify({ pending: this.pending, drafts: this.drafts }));
    } catch {
      throw Error("Черновик вкладки недоступен. Держите страницу открытой и скопируйте ввод перед перезагрузкой.");
    }
  }

  rememberDraft = (key: string, value: string) => {
    this.drafts = { ...this.drafts, [key]: value };
    // Persist synchronously, notify after React has processed the field's onChange.
    try { this.persist(); } catch { setTimeout(() => { this.update({ message: "Не удалось сохранить черновик в этой вкладке. Скопируйте ввод перед перезагрузкой." }); }, 0); }
    setTimeout(() => { this.update({ drafts: this.drafts }); }, 0);
  };
  forgetDraft = (key: string) => {
    this.drafts = Object.fromEntries(Object.entries(this.drafts).filter(([k]) => k !== key));
    this.update({ drafts: this.drafts }); this.persist();
  };
  clearDrafts = () => { this.drafts = {}; this.update({ drafts: {} }); this.persist(); };
  discard = () => {
    if (this.state.sending) throw Error("Дождитесь завершения запроса");
    this.storage.removeItem(this.key);
    this.pending = null; this.drafts = {};
    this.update({ pending: false, message: "", intent: "", conflict: false, authRequired: false, drafts: {} });
  };
  private async send(pending: Pending): Promise<string | null> {
    if (this.state.sending) throw Error("Запрос уже выполняется");
    this.pending = pending;
    this.update({ pending: true, sending: true, intent: JSON.stringify(pending.body, null, 2), message: "", conflict: false, authRequired: false });
    const drafts = this.drafts;
    try {
      this.persist();
      const path = pending.kind === "project" ? `/api/v1/projects/${pending.body.projectId}/commands`
        : pending.kind === "create" ? "/api/v1/projects"
        : pending.kind === "workspace" ? "/api/v1/workspace/commands"
        : pending.kind === "people" ? "/api/v1/people/commands"
        : `/api/v1/projects/${pending.projectId}/view`;
      const response = await this.api(path, pending.kind === "view" ? "PUT" : "POST", pending.body);
      let projectId: string | null = null;
      if (pending.kind === "view") {
        this.views[pending.projectId] = viewSchema.shape.value.parse(z.object({ value: z.unknown() }).parse(response).value);
      } else {
        const result = commandResultSchema.parse(response);
        if (result.commandId !== pending.body.commandId) throw Error("Сервер не подтвердил исходную команду");
        projectId = result.projectId;
        this.revision = result.workspaceRevision;
        if (pending.kind === "project" && result.revision !== pending.body.expectedRevision) {
          const links = this.ownRevisions.get(pending.body.projectId) ?? new Map<number, number>();
          links.set(pending.body.expectedRevision, result.revision);
          this.ownRevisions.set(pending.body.projectId, links);
        }
      }
      this.pending = null;
      const remaining = pending.kind === "view" ? this.drafts : Object.fromEntries(Object.entries(this.drafts).filter(([key, value]) => drafts[key] !== value));
      this.drafts = remaining;
      this.update({ pending: false, sending: false, message: "", intent: "", drafts: remaining });
      this.persist();
      return projectId;
    } catch (e) {
      this.update({ sending: false, message: e instanceof Error ? e.message : "Запись не подтверждена; правка сохранена.",
        conflict: e instanceof ApiError && e.code === "REVISION_CONFLICT", authRequired: e instanceof ApiError && e.status === 401 });
      throw e;
    }
  }
  private mutate(pending: Pending) {
    if (this.pending || this.state.pending) throw Error("Сначала разрешите неподтверждённую правку. Новая команда не отправлена.");
    return this.send(pendingSchema.parse(pending));
  }
  retry = () => this.pending ? this.send(this.pending) : Promise.resolve(null);
  reapply = async () => {
    if (!this.pending || !this.state.conflict) throw Error("Повтор с новой ревизией возможен только после явного конфликта");
    if (this.state.sending) throw Error("Запрос уже выполняется");
    const old = this.pending;
    this.update({ sending: true });
    try {
      // Re-read only after an explicit review action. Unknown outcomes always retry the SAME ID.
      let next: Pending;
      if (old.kind === "project") {
        const d = snapshotSchema.parse(await this.api(`/api/v1/projects/${old.body.projectId}`));
        next = { ...old, body: { ...old.body, commandId: crypto.randomUUID(), expectedRevision: d.project.revision } };
      } else if (old.kind === "people") {
        const c = z.object({ revision: z.number().int().nonnegative() }).parse(await this.api("/api/v1/people"));
        next = { ...old, body: { ...old.body, commandId: crypto.randomUUID(), expectedRevision: c.revision } };
      } else if (old.kind === "create" || old.kind === "workspace") {
        if (old.kind === "workspace" && old.body.command.type === "DuplicateProject") throw Error("Для копирования повторите действие после сверки проекта");
        const w = workspaceSchema.parse(await this.api("/api/v1/workspaces/current"));
        next = pendingSchema.parse({ ...old, body: { ...old.body, commandId: crypto.randomUUID(), expectedRevision: w.workspace.revision } });
      } else throw Error("Сверьте настройки представления");
      this.ownRevisions.clear();
      this.update({ sending: false });
      return await this.send(next);
    } catch (e) {
      this.update({ sending: false, message: e instanceof Error ? e.message : "Повтор не выполнен. Черновик сохранён." });
      throw e;
    }
  };
  async screen(id: string | null) {
    const workspace = workspaceSchema.parse(await this.api("/api/v1/workspaces/current"));
    const [list, rawCatalog, active] = await Promise.all([
      this.list(), this.api("/api/v1/people"), id ? this.load(id) : Promise.resolve(null),
    ]);
    const catalog = catalogSchema.parse({ ...z.object({ workspaceId: z.literal(WORKSPACE_ID), revision: z.number(), people: z.array(z.unknown()), retiredAssignments: z.array(z.unknown()) }).parse(rawCatalog), version: 1, undo: [], redo: [] });
    this.documents = list.projects; this.revision = list.revision;
    if (workspace.workspace.id !== catalog.workspaceId) throw Error("Неверное рабочее пространство");
    if (active && !this.pending) this.views[active.project.id] = active.viewPreferences;
    return { documents: this.documents, active, preferences: this.preferences, views: { ...this.views }, catalog,
      portfolio: { ...emptyPortfolio(), revision: this.revision, order: this.documents.map((d) => d.project.id) }, historyIssues: [] };
  }
  private async list() {
    const projects: z.infer<typeof projectSummarySchema>[] = [];
    let offset: number | null = 0, revision: number | undefined;
    while (offset !== null) {
      const page = pageSchema.parse(await this.api(`/api/v1/projects?limit=100&offset=${String(offset)}`));
      if (revision !== undefined && revision !== page.workspaceRevision) throw Error("Список проектов изменился во время загрузки. Повторите загрузку.");
      revision = page.workspaceRevision; projects.push(...page.projects);
      if (page.nextOffset !== null && page.nextOffset <= offset) throw Error("Неверная страница списка проектов");
      offset = page.nextOffset;
    }
    return { projects, revision: revision ?? 0 };
  }
  private async load(id: string) {
    projectIdSchema.parse(id);
    try { return snapshotSchema.parse(await this.api(`/api/v1/projects/${id}`)); }
    catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }
  envelope(d: Snapshot, command: ContentCommand): CommandEnvelope {
    return { commandId: crypto.randomUUID(), version: 1, workspaceId: d.project.workspaceId, projectId: d.project.id, expectedRevision: d.project.revision, command };
  }
  async execute(input: CommandEnvelope) { await this.mutate({ kind: "project", body: envelopeSchema.parse(input) }); }
  executeLocal(input: CommandEnvelope) {
    let revision = input.expectedRevision;
    const links = this.ownRevisions.get(input.projectId);
    while (links?.has(revision)) revision = links.get(revision) ?? revision;
    return this.execute({ ...input, expectedRevision: revision });
  }
  async projectCommand(id: string, command: ContentCommand, revision?: number, local = false) {
    const d = await this.load(id);
    if (!d) throw Error("Проект не найден");
    const e = { ...this.envelope(d, command), expectedRevision: revision ?? d.project.revision };
    return local ? this.executeLocal(e) : this.execute(e);
  }
  async create(input: Parameters<UIService["create"]>[0]) {
    const id = await this.mutate({ kind: "create", body: createProjectSchema.parse({ ...this.base(this.revision), name: input.name, description: input.description, startDate: input.startDate }) });
    return projectIdSchema.parse(id);
  }
  private base(expectedRevision: number) { return { commandId: crypto.randomUUID(), version: 1 as const, workspaceId: WORKSPACE_ID, expectedRevision }; }
  async portfolioCommand(expected: number, command: PortfolioCommand | "undo" | "redo") {
    if (typeof command === "string") throw Error("Серверный Undo/Redo пока не поддерживается");
    await this.mutate({ kind: "workspace", body: workspaceCommandSchema.parse({ ...this.base(expected), command }) });
  }
  async duplicate(id: string) {
    const source = this.documents.find((d) => d.project.id === id);
    if (!source) throw Error("Проект не найден");
    const result = await this.mutate({ kind: "workspace", body: workspaceCommandSchema.parse({ ...this.base(this.revision), command: { type: "DuplicateProject", id, expectedProjectRevision: source.project.revision } }) });
    return projectIdSchema.parse(result);
  }
  async peopleExecute(body: PeopleEnvelope) { await this.mutate({ kind: "people", body: peopleEnvelopeSchema.parse(body) }); }
  history() { return { canUndo: false, canRedo: false }; }
  undo(): Promise<void> { return Promise.reject(Error("Серверный Undo/Redo пока не поддерживается")); }
  peopleUndo(): Promise<void> { return this.undo(); }
  async saveView(projectId: ProjectId, value: ViewPreferences) { await this.mutate({ kind: "view", projectId, body: viewSchema.parse({ workspaceId: WORKSPACE_ID, value }) }); }
  savePreferences(value: WorkspacePreferences) { this.preferences = workspacePreferencesSchema.parse(value); return Promise.resolve(); }
  async exportBackup() {
    const [list, rawCatalog] = await Promise.all([this.list(), this.api("/api/v1/people")]);
    const documents = await Promise.all(list.projects.map((d) => this.load(d.project.id)));
    if (documents.some((d) => !d)) throw Error("Проект изменился во время экспорта. Повторите экспорт.");
    const catalog = catalogSchema.parse({ ...z.object({ workspaceId: z.string(), revision: z.number(), people: z.array(z.unknown()), retiredAssignments: z.array(z.unknown()) }).parse(rawCatalog), version: 1, undo: [], redo: [] });
    return JSON.stringify(v2BackupSchema.parse({ format: "timeline-backup", version: 2, exportedAt: new Date().toISOString(), documents, catalog: { people: catalog.people, retiredAssignments: catalog.retiredAssignments }, portfolioOrder: list.projects.map((d) => d.project.id), preferences: this.preferences }), null, 2);
  }
  previewImport(): ReturnType<UIService["previewImport"]> { return Promise.reject(Error("Импорт локальных данных на сервер требует отдельного решения")); }
  importBackup(): Promise<void> { return Promise.reject(Error("Импорт на сервер пока не поддерживается")); }
}
