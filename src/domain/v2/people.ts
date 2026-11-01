import { z } from "zod";
import {
  activeAssignment,
  catalogSchema,
  fullName,
  personFieldsSchema,
  samePerson,
} from "./peopleModel";
import type {
  Person,
  PersonFields,
  CatalogState,
  PeopleEntry,
  RetiredAssignment,
} from "./peopleModel";
import type { Snapshot } from "./model";
export const peopleCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("CreatePerson"),
    id: z.uuid(),
    fields: personFieldsSchema,
  }),
  z.strictObject({
    type: z.literal("UpdatePerson"),
    id: z.uuid(),
    fields: personFieldsSchema,
  }),
  z.strictObject({ type: z.literal("ArchivePerson"), id: z.uuid() }),
  z.strictObject({ type: z.literal("RestorePerson"), id: z.uuid() }),
]);
export type PeopleCommand = z.infer<typeof peopleCommandSchema>;
export const peopleEnvelopeSchema = z.strictObject({
  commandId: z.uuid(),
  workspaceId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  command: peopleCommandSchema,
});
export type PeopleEnvelope = z.infer<typeof peopleEnvelopeSchema>;
export function newPerson(
  catalog: CatalogState,
  id: string,
  fields: PersonFields,
): Person {
  if (![fields.firstName, fields.lastName].some((s) => s.trim()))
    throw Error("Заполните имя или фамилию исполнителя");
  if (catalog.people.some((p) => p.id === id))
    throw Error("Карточка с таким ID уже существует");
  if (catalog.people.filter((p) => !p.archivedAt).length >= 100)
    throw Error("Лимит: 100 активных исполнителей");
  return {
    ...fields,
    firstName: fields.firstName.trim(),
    lastName: fields.lastName.trim(),
    defaultRole: fields.defaultRole.trim(),
    id,
    workspaceId: catalog.workspaceId,
    archivedAt: null,
    linkedUserId: null,
    revision: 0,
  };
}
function retirementsFor(
  catalog: CatalogState,
  person: Person,
  documents: readonly Snapshot[],
  now: string,
): RetiredAssignment[] {
  return documents.flatMap((d) =>
    d.assignments
      .filter((a) => a.personId === person.id && activeAssignment(a, catalog))
      .map((a) => ({
        assignmentId: a.id,
        workspaceId: d.project.workspaceId,
        projectId: d.project.id,
        kind: a.kind,
        targetId: a.targetId,
        personId: person.id,
        nameSnapshot: fullName(person),
        roleLabel: a.roleLabel,
        changedAt: now,
      })),
  );
}
export function applyPeople(
  source: CatalogState,
  input: PeopleEnvelope,
  documents: readonly Snapshot[],
  now: string,
): CatalogState {
  const e = peopleEnvelopeSchema.parse(input),
    c = e.command;
  if (
    e.workspaceId !== source.workspaceId ||
    e.expectedRevision !== source.revision
  )
    throw Error(
      "Справочник изменён в другой вкладке. Обновите данные и повторите",
    );
  const before = source.people.find((p) => p.id === c.id) ?? null;
  if (!before && c.type !== "CreatePerson")
    throw Error("Исполнитель не найден");
  let after: Person;
  let retiredAdded: RetiredAssignment[] = [];
  if (c.type === "CreatePerson") after = newPerson(source, c.id, c.fields);
  else {
    if (!before) throw Error("Карточка не найдена");
    after = { ...before };
    if (c.type === "UpdatePerson") {
      if (before.archivedAt)
        throw Error("Сначала восстановите карточку из архива");
      if (![c.fields.firstName, c.fields.lastName].some((s) => s.trim()))
        throw Error("Заполните имя или фамилию");
      Object.assign(after, c.fields, {
        firstName: c.fields.firstName.trim(),
        lastName: c.fields.lastName.trim(),
        defaultRole: c.fields.defaultRole.trim(),
      });
    } else if (c.type === "ArchivePerson") {
      if (before.archivedAt) return source;
      after.archivedAt = now;
      retiredAdded = retirementsFor(source, before, documents, now);
    } else {
      if (!before.archivedAt) return source;
      if (source.people.filter((p) => !p.archivedAt).length >= 100)
        throw Error("Лимит: 100 активных исполнителей");
      after.archivedAt = null;
    }
    if (samePerson(before, after)) return source;
    after.revision = before.revision + 1;
  }
  const entry: PeopleEntry = { id: e.commandId, before, after, retiredAdded };
  return catalogSchema.parse({
    ...source,
    revision: source.revision + 1,
    people: [...source.people.filter((p) => p.id !== c.id), after],
    retiredAssignments: [...source.retiredAssignments, ...retiredAdded],
    undo: [...source.undo, entry],
    redo: [],
  });
}
export function undoPeople(
  source: CatalogState,
  redo: boolean,
  documents: readonly Snapshot[],
  now: string,
): CatalogState {
  const entry = (redo ? source.redo : source.undo).at(-1);
  if (!entry) return source;
  const expected = redo ? entry.before : entry.after,
    target = redo ? entry.after : entry.before,
    id = expected?.id ?? target?.id;
  if (!id) throw Error("Некорректная запись истории справочника");
  const present = source.people.find((p) => p.id === id);
  if (!samePerson(present, expected))
    throw Error(
      "Карточка изменилась после этого действия. История не перезаписывает новые данные",
    );
  if (
    !target &&
    documents.some((d) =>
      d.assignments.some(
        (a) => a.personId === id && activeAssignment(a, source),
      ),
    )
  )
    throw Error(
      "Исполнитель используется в назначениях. Сначала снимите назначения, затем повторите отмену",
    );
  const person = target
    ? {
        ...target,
        revision:
          Math.max(target.revision, present?.revision ?? source.revision) + 1,
      }
    : null;
  if (
    person &&
    !person.archivedAt &&
    (!present || present.archivedAt) &&
    source.people.filter((p) => !p.archivedAt).length >= 100
  )
    throw Error("Лимит: 100 активных исполнителей");
  let retiredAdded = entry.retiredAdded;
  if (redo && person?.archivedAt && expected && !expected.archivedAt) {
    const ids = new Set(retiredAdded.map((r) => r.assignmentId));
    retiredAdded = [
      ...retiredAdded,
      ...retirementsFor(source, expected, documents, now).filter(
        (r) => !ids.has(r.assignmentId),
      ),
    ];
  }
  const actual = { ...entry, retiredAdded },
    retiredIds = new Set(retiredAdded.map((r) => r.assignmentId));
  return catalogSchema.parse({
    ...source,
    revision: source.revision + 1,
    people: [
      ...source.people.filter((p) => p.id !== id),
      ...(person ? [person] : []),
    ],
    retiredAssignments: redo
      ? [
          ...source.retiredAssignments.filter(
            (r) => !retiredIds.has(r.assignmentId),
          ),
          ...retiredAdded,
        ]
      : source.retiredAssignments.filter(
          (r) => !retiredIds.has(r.assignmentId),
        ),
    undo: redo ? [...source.undo, actual] : source.undo.slice(0, -1),
    redo: redo ? source.redo.slice(0, -1) : [...source.redo, actual],
  });
}
/** A project-scoped creation has exactly one project history entry, including its catalog effect. */
export function embeddedPersonChange(
  source: CatalogState,
  person: Person,
  remove: boolean,
  documents: readonly Snapshot[],
): CatalogState {
  const present = source.people.find((p) => p.id === person.id);
  if (remove) {
    if (!samePerson(present, person))
      throw Error(
        "Новая карточка уже изменена. Её нельзя отменить поверх общих изменений",
      );
    if (
      documents.some((d) =>
        d.assignments.some(
          (a) => a.personId === person.id && activeAssignment(a, source),
        ),
      )
    )
      throw Error(
        "Новая карточка уже используется в другом назначении. Отмена не перезаписала данные",
      );
  } else {
    if (present) throw Error("ID карточки уже занят. Повтор не записан");
    if (
      !person.archivedAt &&
      source.people.filter((p) => !p.archivedAt).length >= 100
    )
      throw Error("Лимит: 100 активных исполнителей");
  }
  return catalogSchema.parse({
    ...source,
    revision: source.revision + 1,
    people: [
      ...source.people.filter((p) => p.id !== person.id),
      ...(remove
        ? []
        : [
            {
              ...person,
              revision: Math.max(person.revision, source.revision) + 1,
            },
          ]),
    ],
  });
}
