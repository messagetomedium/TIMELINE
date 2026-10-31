import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { V2Database, V2Repository } from "./V2Repository";
import { CommandService } from "../../application/v2/CommandService";
import { duplicateWorkCommand } from "../../application/v2/workCommands";
import { semantic } from "../../application/v2/history";
import { dateOnly, laneIdSchema } from "../../domain";
import { required } from "../../testing/required";
const dbs: V2Database[] = [];
async function setup() {
  const db = new V2Database(`work-${crypto.randomUUID()}`);
  dbs.push(db);
  const repo = new V2Repository(db),
    service = new CommandService(repo);
  const id = await service.create({
    type: "CreateProject",
    name: "Работы",
    description: "",
    startDate: dateOnly("2026-11-02"),
  });
  return { db, repo, service, id };
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete();
});
it("copies/deletes a process and its result atomically; each undo/redo survives reopening with exact links", async () => {
  const { db, repo, service, id } = await setup();
  let d = required(await repo.load(id));
  const p = required(d.processes[0]);
  await service.execute(
    service.envelope(d, {
      type: "UpdateResult",
      id: crypto.randomUUID(),
      stageId: p.stageId,
      processId: p.id,
      field: "title",
      value: "Связанный результат",
    }),
  );
  d = required(await repo.load(id));
  await service.execute(
    service.envelope(
      d,
      duplicateWorkCommand(d, "process", p.id, () => crypto.randomUUID()),
    ),
  );
  const copied = required(await repo.load(id));
  await service.execute(
    service.envelope(copied, { type: "DeleteWork", kind: "process", id: p.id }),
  );
  const deleted = required(await repo.load(id));
  db.close();
  await db.open();
  const next = new CommandService(repo);
  await next.snapshot();
  await next.undo(id);
  expect(semantic(required(await repo.load(id)))).toBe(semantic(copied));
  await next.undo(id);
  expect(semantic(required(await repo.load(id)))).toBe(semantic(d));
  await next.undo(id, true);
  await next.undo(id, true);
  expect(semantic(required(await repo.load(id)))).toBe(semantic(deleted));
});
it("one grouped reparent restores source rows, parents and all dates with one undo and preserves no-op redo", async () => {
  const { repo, service, id } = await setup(),
    d = required(await repo.load(id)),
    p = required(d.processes[0]),
    target = required(d.processes[1]),
    tasks = d.tasks.filter((t) => t.processId === p.id),
    lane = required(tasks[0]).laneId;
  await service.execute(
    service.envelope(d, {
      type: "GroupMove",
      kind: "task",
      ids: tasks.map((t) => t.id),
      days: 1,
      destination: {
        parentId: target.id,
        beforeLaneId: null,
        rows: [
          {
            sourceLaneId: lane,
            laneId: laneIdSchema.parse(crypto.randomUUID()),
          },
        ],
      },
    }),
  );
  const moved = required(await repo.load(id));
  expect(moved.project.revision).toBe(d.project.revision + 1);
  await service.undo(id);
  const undone = required(await repo.load(id)),
    row = await repo.loadHistory(id);
  await service.execute(
    service.envelope(undone, {
      type: "GroupMove",
      kind: "task",
      ids: tasks.map((t) => t.id),
      days: 0,
    }),
  );
  expect(await repo.loadHistory(id)).toEqual(row);
  expect(semantic(undone)).toBe(semantic(d));
  await service.undo(id, true);
  expect(semantic(required(await repo.load(id)))).toBe(semantic(moved));
});
it("failed storage rolls back a grouped move and leaves document, views and history token untouched", async () => {
  const { db, repo, service, id } = await setup(),
    d = required(await repo.load(id)),
    p = required(d.processes[0]);
  await repo.saveView(id, d.viewPreferences);
  const views = await repo.views(),
    history = await repo.loadHistory(id);
  const fail = () => {
    throw Error("history storage failed");
  };
  db.history.hook("creating", fail);
  try {
    await expect(
      service.execute(
        service.envelope(d, {
          type: "GroupMove",
          kind: "process",
          ids: [p.id],
          days: 3,
        }),
      ),
    ).rejects.toThrow("history storage failed");
  } finally {
    db.history.hook("creating").unsubscribe(fail);
  }
  expect(await repo.load(id)).toEqual(d);
  expect(await repo.views()).toEqual(views);
  expect(await repo.loadHistory(id)).toEqual(history);
});
