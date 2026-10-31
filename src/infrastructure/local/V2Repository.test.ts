import { required } from "../../testing/required";
import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { V2Database, V2Repository } from "./V2Repository";
import { CommandService } from "../../application/v2/CommandService";
import { dateOnly } from "../../domain";
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
it('failed persistence never publishes an undo entry or claims a saved change',async()=>{
 const {repo,service,db}=setup();const id=await service.create(input);const before=required(await repo.load(id));
 db.close();
 // Closing the adapter with autoOpen disabled simulates unavailable storage, not a domain failure.
 await db.open();db.close({disableAutoOpen:true});
 await expect(service.execute(service.envelope(before,{type:'Rename',kind:'project',id,value:'Не записано'}))).rejects.toThrow();
 expect(service.history(id)).toEqual({canUndo:false,canRedo:false});
 await db.open();expect(await repo.load(id)).toEqual(before);
});
