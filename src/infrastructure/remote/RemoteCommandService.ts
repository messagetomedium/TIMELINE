import { z } from "zod";
import { envelopeSchema } from "../../domain/v2/commands";
import type { CommandEnvelope, ContentCommand } from "../../domain/v2/commands";
import { peopleEnvelopeSchema } from "../../domain/v2/people";
import type { PeopleEnvelope } from "../../domain/v2/people";
import type { CatalogState } from "../../domain/v2/peopleModel";
import { catalogSchema } from "../../domain/v2/peopleModel";
import { WORKSPACE_ID, snapshotSchema } from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
import { projectIdSchema } from "../../domain";
import type { ProjectId, ViewPreferences } from "../../domain";
import { defaultPreferences } from "../../application/workspace/model";
import type { WorkspacePreferences } from "../../application/workspace/model";
import { projectSummarySchema, emptyPortfolio } from "../../application/v2/portfolio";
import type { PortfolioCommand } from "../../application/v2/portfolio";
import { createProjectSchema, workspaceCommandSchema, viewSchema, commandResultSchema } from "../../application/v2/apiContracts";
import type { UIService, ServerRecovery, RecoveryState } from "../../application/v2/uiService";
import { v2BackupSchema } from "../../application/v2/backup";
import { SessionPresentation, tabStorage } from "./SessionPresentation";
import { ApiError, requestApi } from "./ApiClient";
import type { RequestApi } from "./ApiClient";
import { cursorSchema, leasePreparedSchema, leaseProofSchema } from "../../application/v2/collaborationContracts";
import type { Change, LeaseProof } from "../../application/v2/collaborationContracts";
import { watchRealtime } from "./RealtimeChannel";

const pendingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), body: envelopeSchema, lease: leaseProofSchema.optional() }),
  z.object({ kind: z.literal("create"), body: createProjectSchema }),
  z.object({ kind: z.literal("workspace"), body: workspaceCommandSchema }),
  z.object({ kind: z.literal("people"), body: peopleEnvelopeSchema }),
  z.object({ kind: z.literal("view"), projectId: projectIdSchema, body: viewSchema }),
]);
type Pending = Exclude<z.infer<typeof pendingSchema>, { kind: "view" }>; // legacy view records are migrated locally, never retried over HTTP
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
  private readonly presentation: SessionPresentation;
  private catalog: CatalogState | null = null;
  private metadataDirty = true;
  private catalogDirty = false;
  private dirtyProjects = new Set<string>();
  private generation = 0;
  private reads = new Map<string, ReturnType<UIService["screen"]>>();
  private active: Snapshot | null = null;
  private cursor: number | null = null;
  private ownCommands = new Set<string>();
  private userId: string;
  private collaboration: boolean;
  constructor(userId: string, api = requestApi, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = tabStorage, collaboration = false) {
    this.userId = userId; this.collaboration = collaboration;
    this.api = api; this.storage = storage; this.presentation = new SessionPresentation(userId, storage); this.key = `timeline-api-draft-v1:${userId}`;
    try {
      const raw = storage.getItem(this.key);
      if (raw) {
        const restored = storedSchema.parse(JSON.parse(raw) as unknown);
        if (restored.pending?.kind === "view") {
          this.presentation.saveView(restored.pending.projectId, restored.pending.body.value);
          // Preserve any content input captured beside an old view request.
          try { this.storage.setItem(this.key, JSON.stringify({ pending: null, drafts: restored.drafts })); } catch { /* A retired UI intent cannot block content. */ }
        } else this.pending = restored.pending;
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
  private async send(pending: Pending, retry = false): Promise<string | null> {
    if (this.state.sending) throw Error("Запрос уже выполняется");
    this.pending = pending;
    this.update({ pending: true, sending: true, intent: JSON.stringify(pending.body, null, 2), message: "", conflict: false, authRequired: false });
    const drafts = this.drafts;
    this.ownCommands.add(pending.body.commandId);
    if (this.ownCommands.size > 256) this.ownCommands.delete(this.ownCommands.values().next().value ?? "");
    try {
      this.persist();
      const path = pending.kind === "project" ? `/api/v1/projects/${pending.body.projectId}/commands`
        : pending.kind === "create" ? "/api/v1/projects"
        : pending.kind === "workspace" ? "/api/v1/workspace/commands"
        : "/api/v1/people/commands";
      const response = pending.kind === "project" && this.collaboration ? await this.sendLeased(pending, retry) : await this.api(path, "POST", pending.body);
      let projectId: string | null = null;
      const result = commandResultSchema.parse(response);
      if (result.commandId !== pending.body.commandId) throw Error("Сервер не подтвердил исходную команду");
      projectId = result.projectId;
      this.generation++;
      this.metadataDirty ||= pending.kind === "create" || pending.kind === "workspace" || pending.kind === "people" || this.revision !== result.workspaceRevision;
      this.catalogDirty ||= this.catalog?.revision !== result.peopleRevision;
      this.revision = Math.max(this.revision, result.workspaceRevision);
      if (pending.kind === "project") {
        this.dirtyProjects.add(pending.body.projectId);
        // A revision jump includes external commits. Never rebase another queued field over them.
        if (result.revision === pending.body.expectedRevision + 1 && (this.documents.find((d) => d.project.id === projectId)?.project.revision ?? 0) <= result.revision) {
          const links = this.ownRevisions.get(pending.body.projectId) ?? new Map<number, number>();
          links.set(pending.body.expectedRevision, result.revision);
          this.ownRevisions.set(pending.body.projectId, links);
        }
      }
      this.pending = null;
      const remaining = Object.fromEntries(Object.entries(this.drafts).filter(([key, value]) => drafts[key] !== value));
      this.drafts = remaining;
      this.update({ pending: false, sending: false, message: "", intent: "", drafts: remaining });
      try { this.persist(); }
      catch { this.update({ message: "Сервер подтвердил изменение, но очистить черновик вкладки не удалось. Повтор после F5 использует прежний commandId." }); }
      return projectId;
    } catch (e) {
      this.metadataDirty = true;
      this.update({ sending: false, message: e instanceof Error ? e.message : "Запись не подтверждена; правка сохранена.",
        conflict: e instanceof ApiError && e.code === "REVISION_CONFLICT", authRequired: e instanceof ApiError && e.status === 401 });
      throw e;
    }
  }
  private mutate(pending: Pending) {
    if (this.pending || this.state.pending) throw Error("Сначала разрешите неподтверждённую правку. Новая команда не отправлена.");
    return this.send(pending);
  }
  retry = () => this.pending ? this.send(this.pending, true) : Promise.resolve(null);
  private async sendLeased(original: Extract<Pending, { kind: "project" }>, retry: boolean) {
    let pending = original, proof: LeaseProof | undefined = pending.lease, timer: ReturnType<typeof setInterval> | undefined, renewing = false, finished = false;
    const root = `/api/v1/projects/${pending.body.projectId}`;
    const prepare = async () => {
      const result = leasePreparedSchema.parse(await this.api(`${root}/leases`, "POST", pending.body));
      if ("receipt" in result) return result.receipt;
      proof = { id: result.lease.id, fence: result.lease.fence };
      pending = { ...pending, lease: proof }; this.pending = pending; this.persist();
      return null;
    };
    try {
      if (!proof) { const receipt = await prepare(); if (receipt) return receipt; }
      timer = setInterval(() => {
        if (!proof || renewing || finished) return; renewing = true;
        void this.api(`${root}/leases/${proof.id}/renew`, "POST", { commandId: pending.body.commandId, fence: proof.fence })
          .then((value) => { if (value && typeof value === "object" && "committed" in value) clearInterval(timer); })
          .catch(() => { if (!finished) this.update({ message: "Связь с правом изменения прервана. Ожидаем подтверждение команды; черновик сохранён." }); })
          .finally(() => { renewing = false; });
      }, 6000);
      const dispatch = () => this.api(`${root}/commands`, "POST", pending.body, { headers: { "X-Timeline-Lease": proof?.id ?? "", "X-Timeline-Fence": String(proof?.fence) } });
      let result: unknown;
      try { result = await dispatch(); }
      catch (e) {
        if (!(retry && e instanceof ApiError && e.code === "LEASE_STALE")) throw e;
        const receipt = await prepare(); result = receipt ?? await dispatch();
      }
      finished = true; return result;
    } finally {
      clearInterval(timer);
      if (!finished && proof) void this.api(`${root}/leases/${proof.id}`, "DELETE", { commandId: pending.body.commandId, fence: proof.fence }).catch(() => undefined);
      finished = true;
    }
  }
  private async readCursor() {
    const value = cursorSchema.parse(await this.api("/api/v1/realtime/cursor"));
    if (value.userId !== this.userId || value.workspaceId !== WORKSPACE_ID) throw new ApiError(401, "STREAM_IDENTITY");
    return value.sequence;
  }
  startRealtime = (invalidated: () => Promise<void>) => {
    if (!this.collaboration || this.cursor === null) return () => undefined;
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => { clearTimeout(timer); timer = setTimeout(() => { if (alive) void invalidated().catch(() => undefined); }, 80); };
    const status = (synchronization: NonNullable<RecoveryState["synchronization"]>) => {
      if (!alive || this.state.synchronization === synchronization) return;
      this.update({ synchronization, ...(synchronization === "denied" ? { authRequired: true, message: "Доступ к обновлениям завершён. Войдите снова; незавершённый ввод сохранён в этой вкладке." }
        : synchronization === "live" && this.state.authRequired ? { authRequired: false, message: this.state.pending ? "Вход восстановлен. Повторите исходный запрос либо сверьте конфликт; черновик сохранён." : "" } : {}) });
    };
    const stop = watchRealtime({ userId: this.userId, sequence: this.cursor, status,
      resync: async () => {
        const cursor = await this.readCursor(); if (!alive) return cursor;
        this.metadataDirty = true; this.catalogDirty = true; this.generation++;
        await invalidated(); this.cursor = cursor; return cursor;
      }, change: (change: Change) => {
        if (!alive) return; this.cursor = change.sequence;
        if (change.commandId && this.ownCommands.has(change.commandId)) return;
        const known = change.projectId ? this.documents.find((d) => d.project.id === change.projectId)?.project.revision : undefined;
        const workspaceChanged = change.workspaceRevision > this.revision, peopleChanged = change.peopleRevision > (this.catalog?.revision ?? -1);
        const projectChanged = change.projectId !== null && (known === undefined || change.revision > known);
        if (!workspaceChanged && !peopleChanged && !projectChanged) return;
        if (projectChanged && change.projectId) this.ownRevisions.delete(change.projectId);
        this.generation++;
        this.catalogDirty ||= peopleChanged;
        this.metadataDirty ||= workspaceChanged || projectChanged && change.projectId !== this.active?.project.id;
        if (projectChanged && change.projectId === this.active?.project.id) this.dirtyProjects.add(change.projectId);
        invalidate();
      } });
    return () => { alive = false; clearTimeout(timer); stop(); };
  };
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
        // Explicit review creates a new intent; the old fence only proves the old envelope.
        next = { kind: "project", body: { ...old.body, commandId: crypto.randomUUID(), expectedRevision: d.project.revision } };
      } else if (old.kind === "people") {
        const c = z.object({ revision: z.number().int().nonnegative() }).parse(await this.api("/api/v1/people"));
        next = { ...old, body: { ...old.body, commandId: crypto.randomUUID(), expectedRevision: c.revision } };
      } else {
        if (old.kind === "workspace" && old.body.command.type === "DuplicateProject") throw Error("Для копирования повторите действие после сверки проекта");
        const w = workspaceSchema.parse(await this.api("/api/v1/workspaces/current"));
        next = old.kind === "create"
          ? { ...old, body: { ...old.body, commandId: crypto.randomUUID(), expectedRevision: w.workspace.revision } }
          : { ...old, body: { ...old.body, commandId: crypto.randomUUID(), expectedRevision: w.workspace.revision } };
      }
      this.ownRevisions.clear();
      this.update({ sending: false });
      return await this.send(next);
    } catch (e) {
      this.update({ sending: false, message: e instanceof Error ? e.message : "Повтор не выполнен. Черновик сохранён." });
      throw e;
    }
  };
  async screen(id: string | null, afterCommand = false) {
    const key = `${id ?? ""}:${String(afterCommand)}`;
    const pending = this.reads.get(key);
    if (pending) return pending;
    const read = this.readScreen(id, afterCommand);
    this.reads.set(key, read);
    try { return await read; } finally { this.reads.delete(key); }
  }
  private async readCatalog() {
    return catalogSchema.parse({ ...z.object({ workspaceId: z.literal(WORKSPACE_ID), revision: z.number(), people: z.array(z.unknown()), retiredAssignments: z.array(z.unknown()) }).parse(await this.api("/api/v1/people")), version: 1, undo: [], redo: [] });
  }
  private async readScreen(id: string | null, afterCommand: boolean): ReturnType<UIService["screen"]> {
    // Capture BEFORE snapshot reads: replay includes any commit racing their completion.
    if (this.collaboration && this.cursor === null) this.cursor = await this.readCursor();
    const generation = this.generation;
    let active: Snapshot | null;
    if (afterCommand && !this.metadataDirty && this.catalog) {
      // ACK revisions identify what can have changed. No workspace/list fetch per field edit.
      const ids = new Set([...this.dirtyProjects, ...(id && id !== this.active?.project.id ? [id] : [])]);
      const [docs, catalog] = await Promise.all([
        Promise.all([...ids].map((key) => this.load(key))), this.catalogDirty ? this.readCatalog() : Promise.resolve(this.catalog),
      ]);
      this.documents = this.documents.map((summary) => {
        const updated = docs.find((d) => d?.project.id === summary.project.id);
        return updated ? { project: updated.project } : summary;
      });
      this.catalog = catalog; active = docs.find((d) => d?.project.id === id) ?? (this.active?.project.id === id ? this.active : null);
    } else {
      const [rawWorkspace, list, catalog, detail] = await Promise.all([
        this.api("/api/v1/workspaces/current"), this.list(), this.readCatalog(), id ? this.load(id) : Promise.resolve(null),
      ]);
      workspaceSchema.parse(rawWorkspace);
      this.documents = list.projects; this.revision = list.revision; this.catalog = catalog; active = detail;
    }
    if (generation !== this.generation) { this.metadataDirty = true; return this.readScreen(id, false); }
    this.dirtyProjects.clear(); this.metadataDirty = false; this.catalogDirty = false;
    this.active = active;
    this.preferences = this.presentation.workspace();
    const views: Record<string, ViewPreferences> = active ? { [active.project.id]: this.presentation.view(active) } : {};
    return { documents: this.documents, active, preferences: this.preferences, views, catalog: this.catalog,
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
    const project = this.documents.find((d) => d.project.id === id)?.project ?? (await this.load(id))?.project;
    if (!project) throw Error("Проект не найден");
    const e = envelopeSchema.parse({ ...this.base(revision ?? project.revision), projectId: id, command });
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
  saveView(projectId: ProjectId, value: ViewPreferences) { this.presentation.saveView(projectId, value); return Promise.resolve(); }
  savePreferences(value: WorkspacePreferences) { this.presentation.saveWorkspace(value); this.preferences = value; return Promise.resolve(); }
  async exportBackup() {
    const [list, rawCatalog] = await Promise.all([this.list(), this.api("/api/v1/people")]);
    const documents = (await Promise.all(list.projects.map((d) => this.load(d.project.id)))).map((d) => d ? { ...d, viewPreferences: this.presentation.view(d) } : null);
    if (documents.some((d) => !d)) throw Error("Проект изменился во время экспорта. Повторите экспорт.");
    const catalog = catalogSchema.parse({ ...z.object({ workspaceId: z.string(), revision: z.number(), people: z.array(z.unknown()), retiredAssignments: z.array(z.unknown()) }).parse(rawCatalog), version: 1, undo: [], redo: [] });
    return JSON.stringify(v2BackupSchema.parse({ format: "timeline-backup", version: 2, exportedAt: new Date().toISOString(), documents, catalog: { people: catalog.people, retiredAssignments: catalog.retiredAssignments }, portfolioOrder: list.projects.map((d) => d.project.id), preferences: this.preferences }), null, 2);
  }
  previewImport(): ReturnType<UIService["previewImport"]> { return Promise.reject(Error("Импорт локальных данных на сервер требует отдельного решения")); }
  importBackup(): Promise<void> { return Promise.reject(Error("Импорт на сервер пока не поддерживается")); }
}
