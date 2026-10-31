import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { afterEach, expect, it } from "vitest";
import { V2Database, V2Repository } from "./V2Repository";
import { CommandService } from "../../application/v2/CommandService";
import { dateOnly } from "../../domain";
import { createTemplate } from "../../domain/v2/template";
import { historyKey, semantic } from "../../application/v2/history";
import { required } from "../../testing/required";
const dbs: V2Database[] = [];
const input = {
  type: "CreateProject" as const,
  name: "История",
  description: "",
  startDate: dateOnly("2026-11-02"),
};
function setup() {
  const db = new V2Database(`test-history-${crypto.randomUUID()}`);
  dbs.push(db);
  const repo = new V2Repository(db);
  return { db, repo, service: new CommandService(repo) };
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete();
});
it("reopens the database and restores independent Undo and Redo stacks per project", async () => {
  const { db, repo, service } = setup(),
    a = await service.create(input),
    b = await service.create({ ...input, name: "Второй" });
  for (const id of [a, b]) {
    const d = required(await repo.load(id));
    await service.execute(
      service.envelope(d, {
        type: "Rename",
        kind: "project",
        id,
        value: `${d.project.name} +`,
      }),
    );
  }
  await service.undo(a);
  db.close();
  await db.open();
  const reopened = new CommandService(new V2Repository(db));
  await reopened.snapshot();
  expect(reopened.history(a)).toEqual({ canUndo: false, canRedo: true });
  expect(reopened.history(b)).toEqual({ canUndo: true, canRedo: false });
  await reopened.undo(a, true);
  await reopened.undo(b);
  expect(required(await repo.load(a)).project.name).toBe("История +");
  expect(required(await repo.load(b)).project.name).toBe("Второй");
});
it("no-op date, text and view saves after restart preserve revision, redo and the exact stored history token", async () => {
  const { db, repo, service } = setup(),
    id = await service.create(input);
  let d = required(await repo.load(id));
  await service.execute(
    service.envelope(d, {
      type: "ResizeProject",
      edge: "end",
      date: dateOnly("2026-11-18"),
    }),
  );
  await service.undo(id);
  const reopened = new CommandService(repo);
  await reopened.snapshot();
  d = required(await repo.load(id));
  const history = await repo.loadHistory(id);
  for (const command of [
    {
      type: "ResizeProject" as const,
      edge: "end" as const,
      date: d.project.endDateExclusive,
    },
    {
      type: "Rename" as const,
      kind: "project" as const,
      id,
      value: d.project.name,
    },
    {
      type: "SetCheckpointTiming" as const,
      id: required(d.checkpoints[0]).id,
      timing: required(d.checkpoints[0]).timing,
    },
  ])
    await reopened.execute(reopened.envelope(d, command));
  await repo.saveView(id, { ...d.viewPreferences, showResults: true });
  expect(await repo.load(id)).toEqual(d);
  expect(await repo.loadHistory(id)).toEqual(history);
  expect(reopened.history(id).canRedo).toBe(true);
  expect(await db.history.count()).toBe(1);
});
it("history write failure rolls back document, preferences and prior history atomically", async () => {
  const { db, repo, service } = setup(),
    id = await service.create(input);
  let d = required(await repo.load(id));
  await service.execute(
    service.envelope(d, {
      type: "Rename",
      kind: "project",
      id,
      value: "Изменён",
    }),
  );
  d = required(await repo.load(id));
  await repo.saveView(id, d.viewPreferences);
  const row = await repo.loadHistory(id),
    views = await repo.views();
  const fail = () => {
    throw Error("history write failure");
  };
  db.history.hook("updating", fail);
  try {
    await expect(
      service.execute(
        service.envelope(d, {
          type: "DeleteStage",
          id: required(d.stages[0]).id,
        }),
      ),
    ).rejects.toThrow("history write failure");
  } finally {
    db.history.hook("updating").unsubscribe(fail);
  }
  expect(await repo.load(id)).toEqual(d);
  expect(await repo.views()).toEqual(views);
  expect(await repo.loadHistory(id)).toEqual(row);
});
it("incompatible or stale history never overwrites newer data; a new command archives it without deleting it", async () => {
  const { db, repo, service } = setup(),
    id = await service.create(input);
  let d = required(await repo.load(id));
  await service.execute(
    service.envelope(d, {
      type: "Rename",
      kind: "project",
      id,
      value: "Сохранён",
    }),
  );
  d = required(await repo.load(id));
  const row = required(await repo.loadHistory(id));
  const newer = {
    ...d,
    project: {
      ...d.project,
      description: "Новые внешние данные",
      revision: d.project.revision + 1,
    },
  };
  await repo.save(newer, d.project.revision);
  const fresh = new CommandService(repo);
  expect((await fresh.snapshot()).historyIssues).toHaveLength(1);
  await expect(fresh.undo(id)).rejects.toThrow("Данные не перезаписаны");
  expect(await repo.load(id)).toEqual(newer);
  expect(await repo.loadHistory(id)).toEqual(row);
  await fresh.execute(
    fresh.envelope(newer, {
      type: "Describe",
      kind: "project",
      id,
      value: "Новый ввод",
    }),
  );
  expect(await db.history.count()).toBe(2);
  expect(
    (await db.history.toArray()).some(
      (x) =>
        x.key.startsWith("archive:") &&
        JSON.stringify(x.value) === JSON.stringify(row.value),
    ),
  ).toBe(true);
  const bad = {
    key: historyKey(id),
    token: crypto.randomUUID(),
    value: { version: 999 },
  };
  await db.history.put(bad);
  await expect(fresh.undo(id)).rejects.toThrow();
  expect(required(await repo.load(id)).project.description).toBe("Новый ввод");
});
it("rejects a corrupted fingerprint/entry chain even at the same revision", async () => {
  const { db, repo, service } = setup(),
    id = await service.create(input),
    d = required(await repo.load(id));
  await service.execute(
    service.envelope(d, {
      type: "Rename",
      kind: "project",
      id,
      value: "Изменение",
    }),
  );
  const row = required(await repo.loadHistory(id));
  const value = row.value as { fingerprint: string };
  value.fingerprint = "invalid";
  await db.history.put({ ...row, value });
  const reopened = new CommandService(repo);
  await expect(reopened.undo(id)).rejects.toThrow("несовместима");
  expect(required(await repo.load(id)).project.name).toBe("Изменение");
});
it("serializes own queued field edits without accepting a revision from another writer", async () => {
  const { repo, service } = setup(),
    id = await service.create(input),
    d = required(await repo.load(id));
  await service.executeLocal(
    service.envelope(d, {
      type: "Rename",
      kind: "project",
      id,
      value: "Очередь",
    }),
  );
  await service.executeLocal(
    service.envelope(d, {
      type: "Describe",
      kind: "project",
      id,
      value: "Описание",
    }),
  );
  const other = new CommandService(repo),
    latest = required(await repo.load(id));
  await other.execute(
    other.envelope(latest, {
      type: "Describe",
      kind: "project",
      id,
      value: "Другая вкладка",
    }),
  );
  await expect(
    service.executeLocal(
      service.envelope(d, {
        type: "Rename",
        kind: "project",
        id,
        value: "Устарело",
      }),
    ),
  ).rejects.toThrow();
  expect(required(await repo.load(id)).project.name).toBe("Очередь");
});
it("adds a history table to an existing version-2 database without modifying its documents or preferences", async () => {
  const name = `test-upgrade-${crypto.randomUUID()}`,
    old = new Dexie(name);
  old
    .version(2)
    .stores({
      documents: "&project.id,project.updatedAt",
      preferences: "&key",
    });
  const d = createTemplate(
    input.name,
    input.description,
    input.startDate,
    () => crypto.randomUUID(),
    "2026-10-31T12:00:00.000Z",
  );
  const { resultPlacements, ...legacy } = d;
  expect(resultPlacements).toEqual([]);
  await old.table("documents").add(legacy);
  await old
    .table("preferences")
    .add({ key: `editor:${d.project.id}`, value: d.viewPreferences });
  old.close();
  const db = new V2Database(name);
  dbs.push(db);
  const repo = new V2Repository(db);
  expect(semantic(required(await repo.load(d.project.id)))).toBe(semantic(d));
  expect(await db.documents.get(d.project.id)).toEqual(legacy);
  expect((await repo.views())[d.project.id]).toEqual(d.viewPreferences);
  expect(await db.history.count()).toBe(0);
});
it("results, placements and structural changes survive reopen and restore in a single undo each", async () => {
  const { db, repo, service } = setup(),
    id = await service.create(input);
  let d = required(await repo.load(id));
  const resultId = crypto.randomUUID();
  await service.execute(
    service.envelope(d, {
      type: "CreateStandaloneResult",
      id: resultId,
      stageId: required(d.stages[0]).id,
      title: "Итог",
    }),
  );
  d = required(await repo.load(id));
  await service.execute(
    service.envelope(d, { type: "MoveResult", id: resultId, y: 190 }),
  );
  const moved = required(await repo.load(id));
  await service.execute(
    service.envelope(moved, {
      type: "DeleteStage",
      id: required(moved.stages[0]).id,
    }),
  );
  db.close();
  await db.open();
  const fresh = new CommandService(repo);
  await fresh.snapshot();
  await fresh.undo(id);
  expect(semantic(required(await repo.load(id)))).toBe(semantic(moved));
  await fresh.undo(id);
  expect(
    required(required(await repo.load(id)).resultPlacements[0]).layoutMode,
  ).toBe("auto");
  const copied = required(await repo.load(await fresh.duplicate(id)));
  expect(required(copied.resultPlacements[0]).resultId).toBe(
    required(copied.results[0]).id,
  );
  expect(required(copied.results[0]).id).not.toBe(resultId);
});
