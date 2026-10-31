import { required } from "../../testing/required";
import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { V2Database, V2Repository } from "./V2Repository";
import { CommandService } from "../../application/v2/CommandService";
import { dateOnly, processIdSchema, laneIdSchema } from "../../domain";
import { snapshotSchema } from "../../domain/v2/model";
import {
  WorkspaceDatabase,
  IndexedDbProjectRepository,
} from "./IndexedDbProjectRepository";
import { productionDemo } from "../demo/production";
const databases: V2Database[] = [];
function setup() {
  const db = new V2Database(`test-v2-${crypto.randomUUID()}`);
  databases.push(db);
  const repo = new V2Repository(db);
  return { db, repo, service: new CommandService(repo) };
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
const input = {
  type: "CreateProject" as const,
  name: "Проект",
  description: "",
  startDate: dateOnly("2026-11-02"),
};
it("persists scoped commands and keeps separate undo/redo stacks across project navigation", async () => {
  const { repo, service, db } = setup();
  const a = await service.create(input),
    b = await service.create({ ...input, name: "Другой" });
  let d = required(await repo.load(a));
  await service.execute(
    service.envelope(d, {
      type: "Rename",
      kind: "stage",
      id: required(d.stages[0]).id,
      value: "Подготовка",
    }),
  );
  d = required(await repo.load(b));
  await service.execute(
    service.envelope(d, {
      type: "Describe",
      kind: "project",
      id: b,
      value: "Заметка Б",
    }),
  );
  await service.undo(a);
  expect(required(required(await repo.load(a)).stages[0]).title).toBe("Этап 1");
  expect(required(await repo.load(b)).project.description).toBe("Заметка Б");
  await service.undo(a, true);
  expect(required(required(await repo.load(a)).stages[0]).title).toBe(
    "Подготовка",
  );
  db.close();
  const reopened = new V2Database(db.name);
  try {
    expect(
      required(required(await new V2Repository(reopened).load(a)).stages[0])
        .title,
    ).toBe("Подготовка");
  } finally {
    reopened.close();
  }
});
it("does not erase redo for a no-op/view and rejects stale undo rather than overwriting another writer", async () => {
  const { service, repo } = setup();
  const id = await service.create(input);
  let d = required(await repo.load(id));
  await service.execute(
    service.envelope(d, {
      type: "Rename",
      kind: "project",
      id,
      value: "Новое",
    }),
  );
  await service.undo(id);
  d = required(await repo.load(id));
  await service.execute(
    service.envelope(d, {
      type: "Rename",
      kind: "project",
      id,
      value: d.project.name,
    }),
  );
  await repo.saveView(d.project.id, { ...d.viewPreferences, gridStep: "1d" });
  expect(service.history(id).canRedo).toBe(true);
  const other = new CommandService(repo);
  await other.execute(
    other.envelope(d, {
      type: "Describe",
      kind: "project",
      id,
      value: "Другая вкладка",
    }),
  );
  await expect(service.undo(id, true)).rejects.toThrow("другой вкладке");
  expect(required(await repo.load(id)).project.description).toBe(
    "Другая вкладка",
  );
});
it("rolls back invalid/colliding batches, clones all IDs/links, and preserves the original project", async () => {
  const { service, repo } = setup();
  const id = await service.create(input),
    original = required(await repo.load(id));
  const copyId = await service.duplicate(id),
    copy = required(await repo.load(copyId));
  expect(required(copy.processes[0]).stageId).toBe(required(copy.stages[0]).id);
  expect(required(copy.tasks[0]).processId).toBe(
    required(copy.processes[0]).id,
  );
  expect(copy.project.id).not.toBe(id);
  const backup = (await service.previewImport(await service.exportBackup()))
    .backup;
  await expect(service.importBackup(backup, false)).rejects.toThrow();
  expect(await repo.all()).toHaveLength(2);
  const fresh = service.clone(original);
  await expect(repo.insertBatch([fresh, original])).rejects.toThrow();
  expect(await repo.load(fresh.project.id)).toBeNull();
  expect(await repo.load(id)).toEqual(original);
});
it("leaves the previous namespace logically unchanged while V2 is used", async () => {
  const old = new WorkspaceDatabase(`test-v1-${crypto.randomUUID()}`);
  try {
    const legacy = new IndexedDbProjectRepository(old);
    await legacy.initialize(productionDemo);
    const before = await Promise.all([
      old.documents.toArray(),
      old.preferences.toArray(),
      old.metadata.toArray(),
    ]);
    const { service } = setup();
    await service.create(input);
    const after = await Promise.all([
      old.documents.toArray(),
      old.preferences.toArray(),
      old.metadata.toArray(),
    ]);
    expect(after).toEqual(before);
  } finally {
    await old.delete();
  }
});
it("failed persistence never publishes an undo entry or claims a saved change", async () => {
  const { repo, service, db } = setup();
  const id = await service.create(input);
  const before = required(await repo.load(id));
  db.close();
  // Closing the adapter with autoOpen disabled simulates unavailable storage, not a domain failure.
  await db.open();
  db.close({ disableAutoOpen: true });
  await expect(
    service.execute(
      service.envelope(before, {
        type: "Rename",
        kind: "project",
        id,
        value: "Не записано",
      }),
    ),
  ).rejects.toThrow();
  expect(service.history(id)).toEqual({ canUndo: false, canRedo: false });
  await db.open();
  expect(await repo.load(id)).toEqual(before);
});

function business(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(business);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !["revision", "updatedAt", "viewPreferences"].includes(key),
        )
        .map(([key, v]) => [key, business(v)]),
    );
  return value;
}
it("structural commit normalizes saved views atomically and undo restores exact content/IDs without rewinding camera", async () => {
  const { repo, service } = setup(),
    id = await service.create(input),
    before = required(await repo.load(id));
  await repo.saveView(id, {
    ...before.viewPreferences,
    cameraX: 333,
    gridStep: "2w",
  });
  const stage = required(before.stages[0]);
  await service.execute(
    service.envelope(before, { type: "DeleteStage", id: stage.id }),
  );
  const after = required(await repo.load(id));
  expect(after.tasks).toHaveLength(4);
  expect((await repo.views())[id]?.expandedProcessIds).not.toContain(
    required(before.processes[0]).id,
  );
  await service.undo(id);
  const restored = required(await repo.load(id));
  expect(business(restored)).toEqual(business(before));
  expect((await repo.views())[id]?.cameraX).toBe(333);
  await service.undo(id, true);
  expect(business(await repo.load(id))).toEqual(business(after));
});
it("failed preference normalization rolls back the document, view and history together", async () => {
  const { repo, service, db } = setup(),
    id = await service.create(input),
    before = required(await repo.load(id));
  await repo.saveView(id, before.viewPreferences);
  const views = await repo.views();
  const fail = () => {
    throw Error("Simulated preference write failure");
  };
  db.preferences.hook("updating", fail);
  try {
    await expect(
      service.execute(
        service.envelope(before, {
          type: "DeleteStage",
          id: required(before.stages[0]).id,
        }),
      ),
    ).rejects.toThrow("Simulated");
  } finally {
    db.preferences.hook("updating").unsubscribe(fail);
  }
  expect(await repo.load(id)).toEqual(before);
  expect(await repo.views()).toEqual(views);
  expect(service.history(id)).toEqual({ canUndo: false, canRedo: false });
});
it("one ripple commit and undo/redo cover the whole chain and leave another project unchanged", async () => {
  const { repo, service } = setup(),
    id = await service.create(input),
    other = await service.create({ ...input, name: "Соседний" }),
    before = required(await repo.load(id)),
    untouched = await repo.load(other);
  await service.execute(
    service.envelope(before, {
      type: "Timeline",
      command: {
        type: "resize",
        target: { kind: "task", id: required(before.tasks[0]).id },
        edge: "end",
        date: dateOnly("2026-11-12"),
      },
    }),
  );
  const after = required(await repo.load(id));
  expect(after.project.revision).toBe(1);
  expect(required(after.stages[1]).startDate).toBe("2026-11-14");
  expect(
    after.tasks
      .filter((t) => t.processId === required(after.processes[0]).id)
      .map((t) => t.endDateExclusive),
  ).toEqual(["2026-11-12", "2026-11-14"]);
  await service.undo(id);
  expect(business(await repo.load(id))).toEqual(business(before));
  expect(service.history(id).canUndo).toBe(false);
  await service.undo(id, true);
  expect(business(await repo.load(id))).toEqual(business(after));
  expect(await repo.load(other)).toEqual(untouched);
});
it("clear and merge undo restore structure, descriptions and result links and survive reopen", async () => {
  const { repo, service, db } = setup(),
    id = await service.create(input);
  let d = required(await repo.load(id));
  await service.execute(
    service.envelope(d, {
      type: "Describe",
      kind: "stage",
      id: required(d.stages[0]).id,
      value: "Первое описание",
    }),
  );
  d = required(await repo.load(id));
  await service.execute(
    service.envelope(d, {
      type: "MergeStages",
      leftStageId: required(d.stages[0]).id,
      rightStageId: required(d.stages[1]).id,
    }),
  );
  const merged = required(await repo.load(id));
  expect(merged.stages).toHaveLength(1);
  expect(merged.tasks).toHaveLength(8);
  await service.execute(
    service.envelope(merged, {
      type: "ClearStage",
      id: required(merged.stages[0]).id,
      processId: processIdSchema.parse(crypto.randomUUID()),
      laneId: laneIdSchema.parse(crypto.randomUUID()),
    }),
  );
  expect(required(await repo.load(id)).tasks).toHaveLength(0);
  await service.undo(id);
  expect(business(await repo.load(id))).toEqual(business(merged));
  await service.undo(id);
  expect(business(await repo.load(id))).toEqual(business(d));
  db.close();
  await db.open();
  expect(snapshotSchema.safeParse(await repo.load(id)).success).toBe(true);
});
it("insert has deterministic IDs on redo, and stage operations remain valid through clone/JSON", async () => {
  const { repo, service } = setup(),
    id = await service.create(input),
    d = required(await repo.load(id)),
    stageId = crypto.randomUUID();
  await service.execute(
    service.envelope(d, {
      type: "InsertStage",
      id: stageId,
      leftStageId: required(d.stages[0]).id,
      rightStageId: required(d.stages[1]).id,
      title: "Вставка",
      durationDays: 1,
    }),
  );
  const inserted = required(await repo.load(id));
  await service.undo(id);
  await service.undo(id, true);
  expect(business(await repo.load(id))).toEqual(business(inserted));
  expect(required(await repo.load(id)).stages[1]?.id).toBe(stageId);
  const copy = required(await repo.load(await service.duplicate(id)));
  expect(copy.stages).toHaveLength(3);
  expect(copy.stages[1]?.id).not.toBe(stageId);
  const backup = (await service.previewImport(await service.exportBackup()))
    .backup;
  await service.importBackup(backup, true);
  expect(await repo.all()).toHaveLength(4);
});
it("undo restores result-stage links with increasing revisions", async () => {
  const { repo, service } = setup(),
    id = await service.create(input),
    initial = required(await repo.load(id));
  const stage = required(initial.stages[1]),
    process = required(initial.processes[2]);
  initial.results.push({
    id: crypto.randomUUID(),
    workspaceId: initial.project.workspaceId,
    projectId: id,
    stageId: stage.id,
    processId: process.id,
    title: "Существующий результат",
    description: "",
    revision: 0,
  });
  initial.project.revision++;
  await repo.save(initial, 0);
  await service.execute(
    service.envelope(initial, {
      type: "MergeStages",
      leftStageId: required(initial.stages[0]).id,
      rightStageId: stage.id,
    }),
  );
  const merged = required(await repo.load(id));
  expect(merged.results[0]?.stageId).toBe(required(initial.stages[0]).id);
  await service.undo(id);
  const restored = required(await repo.load(id));
  expect(restored.results[0]?.stageId).toBe(stage.id);
  expect(required(restored.results[0]).revision).toBeGreaterThan(
    required(merged.results[0]).revision,
  );
  await service.undo(id, true);
  expect(
    required(required(await repo.load(id)).results[0]).revision,
  ).toBeGreaterThan(required(restored.results[0]).revision);
});
