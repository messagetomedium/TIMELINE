import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { afterEach, it, expect } from "vitest";
import { V2Database, V2Repository } from "./V2Repository";
import { CommandService } from "../../application/v2/CommandService";
import { required } from "../../testing/required";
import { dateOnly, addDays } from "../../domain";
import { activeAssignment, fullName } from "../../domain/v2/peopleModel";
import type { PersonFields } from "../../domain/v2/peopleModel";
import type { PeopleCommand } from "../../domain/v2/people";
import { occupancy } from "../../domain/v2/occupancy";
import { copySourceIds } from "../../domain/v2/work";
import { v2BackupSchema } from "../../application/v2/backup";
const dbs: V2Database[] = [];
function setup() {
  const db = new V2Database(`people-${crypto.randomUUID()}`);
  dbs.push(db);
  const repo = new V2Repository(db);
  return { db, repo, service: new CommandService(repo) };
}
afterEach(async () => {
  for (const d of dbs.splice(0)) await d.delete();
});
const fields: PersonFields = {
  firstName: "Анна",
  lastName: "Иванова",
  defaultRole: "Дизайнер",
  contacts: "anna@example.test",
  note: "Тестовая карточка",
};
const input = {
  type: "CreateProject" as const,
  name: "А",
  description: "",
  startDate: dateOnly("2026-11-02"),
};
async function person(service: CommandService, command: PeopleCommand) {
  const catalog = await service.repository.loadCatalog();
  return service.peopleExecute({
    commandId: crypto.randomUUID(),
    workspaceId: catalog.workspaceId,
    expectedRevision: catalog.revision,
    command,
  });
}
async function assign(
  service: CommandService,
  id: string,
  personId: string | null,
  task = false,
  roleLabel = "Дизайнер",
) {
  const d = required(await service.repository.load(id)),
    w = required(task ? d.tasks[0] : d.processes[0]);
  await service.execute(
    service.envelope(d, {
      type: "SetAssignment",
      kind: task ? "task" : "process",
      targetId: w.id,
      id: crypto.randomUUID(),
      personId,
      roleLabel,
    }),
  );
}
it("shares one person across projects; assignment and workspace histories persist independently after reopening", async () => {
  const { service, repo, db } = setup(),
    a = await service.create(input),
    b = await service.create({ ...input, name: "Б" }),
    pid = crypto.randomUUID();
  await person(service, { type: "CreatePerson", id: pid, fields });
  await assign(service, a, pid);
  await assign(service, b, pid, true);
  const beforeA = required(await repo.load(a)),
    beforeB = required(await repo.load(b));
  await person(service, {
    type: "UpdatePerson",
    id: pid,
    fields: { ...fields, firstName: "Анастасия" },
  });
  expect(await repo.load(a)).toEqual(beforeA);
  expect(await repo.load(b)).toEqual(beforeB);
  expect(fullName(required((await repo.loadCatalog()).people[0]))).toBe(
    "Анастасия Иванова",
  );
  db.close();
  const reopened = new V2Database(db.name);
  try {
    const r = new V2Repository(reopened),
      s = new CommandService(r);
    await s.snapshot();
    expect(s.history(a).canUndo).toBe(true);
    await s.undo(a);
    expect(required(await r.load(a)).assignments).toEqual([]);
    expect(required(await r.load(b)).assignments).toHaveLength(1);
    await s.peopleUndo((await r.loadCatalog()).revision);
    expect(required((await r.loadCatalog()).people[0]).firstName).toBe("Анна");
    await s.undo(a, true);
    expect(required(await r.load(a)).assignments).toHaveLength(1);
  } finally {
    reopened.close();
  }
});
it("archives all effective slots atomically and freezes former names; explicit restore does not revive them", async () => {
  const { service, repo } = setup(),
    a = await service.create(input),
    b = await service.create(input),
    pid = crypto.randomUUID();
  await person(service, { type: "CreatePerson", id: pid, fields });
  await assign(service, a, pid);
  await assign(service, b, pid, true);
  const before = required(await repo.load(a));
  await person(service, { type: "ArchivePerson", id: pid });
  let c = await repo.loadCatalog();
  expect(c.retiredAssignments).toHaveLength(2);
  expect(occupancy(before, c)).toEqual([]);
  expect(c.retiredAssignments[0]?.nameSnapshot).toBe("Анна Иванова");
  expect(await repo.load(a)).toEqual(before);
  await service.undo(a);
  await service.undo(a, true);
  expect(
    activeAssignment(required(required(await repo.load(a)).assignments[0]), c),
  ).toBeUndefined();
  await person(service, { type: "RestorePerson", id: pid });
  await person(service, {
    type: "UpdatePerson",
    id: pid,
    fields: { ...fields, firstName: "Новое имя" },
  });
  c = await repo.loadCatalog();
  expect(c.retiredAssignments[0]?.nameSnapshot).toBe("Анна Иванова");
  expect(occupancy(required(await repo.load(a)), c)).toEqual([]);
  await assign(service, a, pid);
  expect(
    occupancy(required(await repo.load(a)), await repo.loadCatalog()),
  ).toHaveLength(1);
  expect((await repo.loadCatalog()).retiredAssignments).toHaveLength(2);
});
it("Undo Archive revives untouched bindings, preserves newer assignments and never replaces project data", async () => {
  const { service, repo } = setup(),
    a = await service.create(input),
    pid = crypto.randomUUID(),
    other = crypto.randomUUID();
  await person(service, { type: "CreatePerson", id: pid, fields });
  await person(service, {
    type: "CreatePerson",
    id: other,
    fields: { ...fields, firstName: "Борис" },
  });
  await assign(service, a, pid);
  await person(service, { type: "ArchivePerson", id: pid });
  await assign(service, a, other);
  const d = required(await repo.load(a));
  await service.peopleUndo((await repo.loadCatalog()).revision);
  expect(await repo.load(a)).toEqual(d);
  expect(required(occupancy(d, await repo.loadCatalog())[0]).name).toBe(
    "Борис Иванова",
  );
  await service.undo(a);
  expect(
    required(
      occupancy(required(await repo.load(a)), await repo.loadCatalog())[0],
    ).name,
  ).toBe("Анна Иванова");
});
it("creates a separate card for an assignment in one atomic project undo/redo, without renaming the original", async () => {
  const { service, repo } = setup(),
    id = await service.create(input),
    pid = crypto.randomUUID(),
    newId = crypto.randomUUID();
  await person(service, { type: "CreatePerson", id: pid, fields });
  await assign(service, id, pid);
  const d = required(await repo.load(id));
  await service.execute(
    service.envelope(d, {
      type: "CreatePersonAndAssign",
      kind: "process",
      targetId: required(d.processes[0]).id,
      id: crypto.randomUUID(),
      personId: newId,
      roleLabel: "Лид",
      fields: { ...fields, firstName: "Ольга" },
    }),
  );
  expect((await repo.loadCatalog()).people).toHaveLength(2);
  expect((await repo.loadCatalog()).undo).toHaveLength(1);
  await service.undo(id);
  expect((await repo.loadCatalog()).people).toHaveLength(1);
  expect(required(required(await repo.load(id)).assignments[0]).personId).toBe(
    pid,
  );
  await service.undo(id, true);
  expect((await repo.loadCatalog()).people).toHaveLength(2);
  expect(required(required(await repo.load(id)).assignments[0]).personId).toBe(
    newId,
  );
});
it("refuses to undo shared creation when reused or edited elsewhere and rolls back catalog/project/history together", async () => {
  const { service, repo } = setup(),
    a = await service.create(input),
    b = await service.create(input),
    pid = crypto.randomUUID(),
    d = required(await repo.load(a));
  await service.execute(
    service.envelope(d, {
      type: "CreatePersonAndAssign",
      kind: "process",
      targetId: required(d.processes[0]).id,
      id: crypto.randomUUID(),
      personId: pid,
      roleLabel: "Лид",
      fields,
    }),
  );
  await assign(service, b, pid);
  const state = await service.snapshot();
  await expect(service.undo(a)).rejects.toThrow("другом назначении");
  expect((await service.snapshot()).documents).toEqual(state.documents);
  expect(await repo.loadCatalog()).toEqual(state.catalog);
});
it("protects catalog CAS and no-op histories, including a missing person on project Redo", async () => {
  const { service, repo } = setup(),
    id = await service.create(input),
    pid = crypto.randomUUID();
  await person(service, { type: "CreatePerson", id: pid, fields });
  await assign(service, id, pid);
  await service.undo(id);
  const before = await repo.loadCatalog();
  await service.peopleUndo(before.revision);
  await expect(service.undo(id, true)).rejects.toThrow("больше не существует");
  const c = await repo.loadCatalog();
  await expect(
    service.peopleExecute({
      workspaceId: c.workspaceId,
      expectedRevision: before.revision,
      commandId: crypto.randomUUID(),
      command: { type: "CreatePerson", id: crypto.randomUUID(), fields },
    }),
  ).rejects.toThrow("другой вкладке");
  await service.peopleUndo(c.revision, true);
  const current = await repo.loadCatalog();
  await person(service, { type: "UpdatePerson", id: pid, fields });
  expect(await repo.loadCatalog()).toEqual(current);
  expect(service.history(id).canRedo).toBe(true);
});
it("combines all overlapping occupancy on one read-only row, keeps true gaps and process colors", async () => {
  const { service, repo } = setup(),
    id = await service.create(input),
    pid = crypto.randomUUID();
  await person(service, { type: "CreatePerson", id: pid, fields });
  await assign(service, id, pid);
  await assign(service, id, pid, true);
  const d = required(await repo.load(id)),
    p = required(d.processes[1]);
  await service.execute(
    service.envelope(d, {
      type: "SetAssignment",
      kind: "process",
      targetId: p.id,
      id: crypto.randomUUID(),
      personId: pid,
      roleLabel: "Лид",
    }),
  );
  const colored = required(await repo.load(id));
  await service.execute(
    service.envelope(colored, {
      type: "SetProcessColor",
      id: p.id,
      color: "#114477",
    }),
  );
  const rows = occupancy(
    required(await repo.load(id)),
    await repo.loadCatalog(),
  );
  expect(rows).toHaveLength(1);
  expect(
    required(rows[0]).segments.some(
      (s) => s.targetIds.length === 3 && s.colors.length === 2,
    ),
  ).toBe(true);
  const b = await service.create(input);
  await assign(service, b, null, false, "Только роль");
  expect(
    required(
      occupancy(required(await repo.load(b)), await repo.loadCatalog())[0],
    ).name,
  ).toBe("Не назначен");
});
it("copies shared bindings with fresh IDs and removes/restores all assignments with work", async () => {
  const { service, repo } = setup(),
    id = await service.create(input),
    pid = crypto.randomUUID();
  await person(service, { type: "CreatePerson", id: pid, fields });
  await assign(service, id, pid);
  await assign(service, id, pid, true);
  let d = required(await repo.load(id));
  const p = required(d.processes[0]),
    ids = Object.fromEntries(
      copySourceIds(d, "process", p.id).map((old) => [
        old,
        crypto.randomUUID(),
      ]),
    );
  await service.execute(
    service.envelope(d, {
      type: "DuplicateWork",
      kind: "process",
      id: p.id,
      ids,
      newLaneId: crypto.randomUUID() as typeof p.laneId,
    }),
  );
  d = required(await repo.load(id));
  expect(d.assignments).toHaveLength(4);
  expect(d.assignments.every((a) => a.personId === pid)).toBe(true);
  expect(new Set(d.assignments.map((a) => a.id)).size).toBe(4);
  await service.execute(
    service.envelope(d, { type: "DeleteWork", kind: "process", id: p.id }),
  );
  expect(required(await repo.load(id)).assignments).toHaveLength(2);
  await service.undo(id);
  expect(required(await repo.load(id)).assignments).toHaveLength(4);
  const clone = required(await repo.load(await service.duplicate(id)));
  expect(
    clone.assignments.every(
      (a) => a.projectId === clone.project.id && a.personId === pid,
    ),
  ).toBe(true);
  expect(
    clone.assignments.every((a) => !d.assignments.some((x) => x.id === a.id)),
  ).toBe(true);
});
it("exports/imports the shared catalog and immutable records atomically, including copies and name collisions", async () => {
  const one = setup(),
    two = setup(),
    id = await one.service.create(input),
    pid = crypto.randomUUID();
  await person(one.service, { type: "CreatePerson", id: pid, fields });
  await assign(one.service, id, pid);
  await person(one.service, { type: "ArchivePerson", id: pid });
  const backup = v2BackupSchema.parse(
    JSON.parse(await one.service.exportBackup()),
  );
  await two.service.importBackup(backup, false);
  expect((await two.repo.loadCatalog()).retiredAssignments).toHaveLength(1);
  expect(
    occupancy(required(await two.repo.load(id)), await two.repo.loadCatalog()),
  ).toEqual([]);
  await two.service.importBackup(backup, true);
  expect((await two.repo.loadCatalog()).people).toHaveLength(1);
  expect((await two.repo.loadCatalog()).retiredAssignments).toHaveLength(2);
  await person(two.service, { type: "RestorePerson", id: pid });
  await person(two.service, {
    type: "UpdatePerson",
    id: pid,
    fields: { ...fields, firstName: "Другое" },
  });
  await expect(two.service.importBackup(backup, false)).rejects.toThrow(
    "различаются",
  );
  await two.service.importBackup(backup, true);
  expect((await two.repo.loadCatalog()).people).toHaveLength(2);
  expect(await two.repo.all()).toHaveLength(3);
});
it("upgrades DB v3 additively and preserves actual old project history fingerprints", async () => {
  const { repo, service } = setup(),
    id = await service.create(input),
    before = required(await repo.load(id));
  await service.execute(
    service.envelope(before, {
      type: "ResizeProjectRange",
      startDate: addDays(before.project.startDate, -1),
      endDateExclusive: addDays(before.project.endDateExclusive, 1),
    }),
  );
  const value = required(await repo.load(id)),
    row = required(await repo.loadHistory(id));
  const removeEmpty = (v: unknown) =>
    JSON.parse(
      JSON.stringify(v, (k, x: unknown) =>
        k === "assignments" ? undefined : x,
      ),
    ) as unknown;
  const oldName = `old-${crypto.randomUUID()}`,
    old = new Dexie(oldName);
  old.version(2).stores({
    documents: "&project.id,project.updatedAt",
    preferences: "&key",
  });
  old.version(3).stores({ history: "&key" });
  await old.table("documents").put(removeEmpty(value));
  const oldHistory = removeEmpty(row) as typeof row;
  await old.table("history").put(oldHistory);
  old.close();
  const upgraded = new V2Database(oldName);
  dbs.push(upgraded);
  const r = new V2Repository(upgraded),
    s = new CommandService(r);
  expect((await s.snapshot()).historyIssues).toEqual([]);
  expect((await r.loadCatalog()).people).toEqual([]);
  await s.undo(id);
  expect(required(await r.load(id)).project.startDate).toBe(
    before.project.startDate,
  );
  expect(required(await r.load(id)).processes).toEqual(before.processes);
  await s.undo(id, true);
  expect(required(await r.load(id)).project.startDate).toBe(
    value.project.startDate,
  );
});
it("rolls back catalog creation if the project commit races, and guards stale workspace Undo", async () => {
  const { repo, service, db } = setup(),
    id = await service.create(input),
    d = required(await repo.load(id)),
    pid = crypto.randomUUID(),
    p = required(d.processes[0]);
  const original = repo.commit.bind(repo);
  let race = true;
  repo.commit = async (...args) => {
    if (race) {
      race = false;
      await repo.save(
        {
          ...d,
          project: { ...d.project, name: "Другая вкладка", revision: 1 },
        },
        0,
      );
    }
    return original(...args);
  };
  await expect(
    service.execute(
      service.envelope(d, {
        type: "CreatePersonAndAssign",
        kind: "process",
        targetId: p.id,
        id: crypto.randomUUID(),
        personId: pid,
        roleLabel: "Лид",
        fields,
      }),
    ),
  ).rejects.toThrow();
  expect((await repo.loadCatalog()).people).toEqual([]);
  expect(await db.history.count()).toBe(0);
  expect(required(await repo.load(id)).project.name).toBe("Другая вкладка");
  await person(service, { type: "CreatePerson", id: pid, fields });
  const old = await repo.loadCatalog();
  await person(service, {
    type: "UpdatePerson",
    id: pid,
    fields: { ...fields, note: "Новее" },
  });
  await expect(service.peopleUndo(old.revision)).rejects.toThrow(
    "другой вкладке",
  );
  expect(required((await repo.loadCatalog()).people[0]).note).toBe("Новее");
});
it("occupancy preserves unoccupied dates and splits overlaps with independent process colors", async () => {
  const { repo, service } = setup(),
    id = await service.create(input),
    pid = crypto.randomUUID();
  await person(service, { type: "CreatePerson", id: pid, fields });
  let d = required(await repo.load(id));
  for (const t of [required(d.tasks[0]), required(d.tasks[4])]) {
    await service.execute(
      service.envelope(d, {
        type: "SetAssignment",
        kind: "task",
        targetId: t.id,
        id: crypto.randomUUID(),
        personId: pid,
        roleLabel: "Роль",
      }),
    );
    d = required(await repo.load(id));
  }
  const row = required(occupancy(d, await repo.loadCatalog())[0]);
  expect(row.segments).toHaveLength(2);
  expect(
    required(row.segments[0]).endDateExclusive <
      required(row.segments[1]).startDate,
  ).toBe(true);
  expect(required(row.segments[0]).colors).not.toEqual(
    required(row.segments[1]).colors,
  );
  expect(required(row.segments[0]).targetIds).toHaveLength(1);
});
it("rejects a foreign catalog or incompatible workspace history without resetting saved rows", async () => {
  const { repo, service, db } = setup(),
    id = await service.create(input),
    pid = crypto.randomUUID();
  await person(service, { type: "CreatePerson", id: pid, fields });
  const valid = await repo.loadCatalog(),
    foreign = {
      ...valid,
      workspaceId: crypto.randomUUID(),
      people: [],
      undo: [],
      redo: [],
    };
  await db.workspaceData.put({ key: "people", value: foreign });
  await expect(repo.loadCatalog()).rejects.toThrow("другому пространству");
  expect((await db.workspaceData.get("people"))?.value).toEqual(foreign);
  expect(await repo.load(id)).not.toBeNull();
  const invalid = { ...valid, undo: [...valid.undo, ...valid.undo] };
  await db.workspaceData.put({ key: "people", value: invalid });
  await expect(repo.loadCatalog()).rejects.toThrow("Некорректные связи");
  expect((await db.workspaceData.get("people"))?.value).toEqual(invalid);
});
