import { z } from "zod";
import { projectIdSchema } from "../ids";
export const personSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  defaultRole: z.string(),
  contacts: z.string(),
  note: z.string(),
  archivedAt: z.iso.datetime().nullable(),
  linkedUserId: z.uuid().nullable(),
  revision: z.number().int().nonnegative(),
});
export type Person = z.infer<typeof personSchema>;
export const personFieldsSchema = personSchema.pick({
  firstName: true,
  lastName: true,
  defaultRole: true,
  contacts: true,
  note: true,
});
export type PersonFields = z.infer<typeof personFieldsSchema>;
export const assignmentSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: projectIdSchema,
  kind: z.enum(["process", "task"]),
  targetId: z.uuid(),
  personId: z.uuid().nullable(),
  roleLabel: z.string(),
  personSnapshot: z.string(),
  revision: z.number().int().nonnegative(),
});
export type Assignment = z.infer<typeof assignmentSchema>;
export const retiredAssignmentSchema = z.strictObject({
  assignmentId: z.uuid(),
  workspaceId: z.uuid(),
  projectId: projectIdSchema,
  kind: z.enum(["process", "task"]),
  targetId: z.uuid(),
  personId: z.uuid(),
  nameSnapshot: z.string(),
  roleLabel: z.string(),
  changedAt: z.iso.datetime(),
});
export type RetiredAssignment = z.infer<typeof retiredAssignmentSchema>;
export const peopleEntrySchema = z.strictObject({
  id: z.uuid(),
  before: personSchema.nullable(),
  after: personSchema.nullable(),
  retiredAdded: z.array(retiredAssignmentSchema),
});
export type PeopleEntry = z.infer<typeof peopleEntrySchema>;
export const catalogDataSchema = z.strictObject({
  people: z.array(personSchema),
  retiredAssignments: z.array(retiredAssignmentSchema),
});
export type CatalogData = z.infer<typeof catalogDataSchema>;
export const catalogSchema = z
  .strictObject({
    version: z.literal(1),
    workspaceId: z.uuid(),
    revision: z.number().int().nonnegative(),
    ...catalogDataSchema.shape,
    undo: z.array(peopleEntrySchema),
    redo: z.array(peopleEntrySchema),
  })
  .superRefine((d, ctx) => {
    if (
      new Set(d.people.map((p) => p.id)).size !== d.people.length ||
      new Set(d.retiredAssignments.map((r) => r.assignmentId)).size !==
        d.retiredAssignments.length ||
      d.people.some((p) => p.workspaceId !== d.workspaceId) ||
      d.retiredAssignments.some((r) => r.workspaceId !== d.workspaceId) ||
      new Set([...d.undo, ...d.redo].map((e) => e.id)).size !==
        d.undo.length + d.redo.length ||
      [...d.undo, ...d.redo].some(
        (e) =>
          [e.before, e.after].some(
            (p) => p && p.workspaceId !== d.workspaceId,
          ) ||
          (!e.before && !e.after) ||
          new Set(e.retiredAdded.map((r) => r.assignmentId)).size !==
            e.retiredAdded.length ||
          e.retiredAdded.some(
            (r) =>
              r.workspaceId !== d.workspaceId ||
              r.personId !== (e.after?.id ?? e.before?.id),
          ) ||
          (e.before && e.after && e.before.id !== e.after.id),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Некорректные связи справочника. Данные не сброшены",
      });
  });
export type CatalogState = z.infer<typeof catalogSchema>;
export const emptyCatalog = (workspaceId: string): CatalogState => ({
  version: 1,
  workspaceId,
  revision: 0,
  people: [],
  retiredAssignments: [],
  undo: [],
  redo: [],
});
export const fullName = (p: Pick<Person, "firstName" | "lastName">) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
export function activeAssignment(
  a: Assignment,
  catalog: CatalogData | undefined,
) {
  if (!catalog) return a;
  if (catalog.retiredAssignments.some((r) => r.assignmentId === a.id))
    return undefined;
  if (
    a.personId &&
    !catalog.people.some((p) => p.id === a.personId && !p.archivedAt)
  )
    return undefined;
  return a;
}
export function samePerson(
  a: Person | null | undefined,
  b: Person | null | undefined,
) {
  const value = (p: Person | null | undefined) =>
    p ? JSON.stringify({ ...p, revision: 0 }) : null;
  return value(a) === value(b);
}
