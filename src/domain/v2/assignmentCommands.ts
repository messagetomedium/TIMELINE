import { z } from "zod";
import { activeAssignment, fullName, personFieldsSchema } from "./peopleModel";
import type { CatalogData } from "./peopleModel";
import type { Snapshot } from "./model";
const assign = {
  kind: z.enum(["process", "task"]),
  targetId: z.uuid(),
  id: z.uuid(),
  personId: z.uuid().nullable(),
  roleLabel: z.string(),
};
export const assignmentCommands = [
  z.strictObject({ type: z.literal("SetAssignment"), ...assign }),
  z.strictObject({
    type: z.literal("CreatePersonAndAssign"),
    kind: assign.kind,
    targetId: assign.targetId,
    id: assign.id,
    personId: z.uuid(),
    roleLabel: z.string(),
    fields: personFieldsSchema,
  }),
] as const;
export type AssignmentCommand = z.infer<(typeof assignmentCommands)[number]>;
export function applyAssignment(
  d: Snapshot,
  c: AssignmentCommand,
  people: CatalogData | undefined,
) {
  if (
    !(c.kind === "process" ? d.processes : d.tasks).some(
      (w) => w.id === c.targetId,
    )
  )
    throw Error("Работа для назначения не найдена");
  const person = c.personId
    ? people?.people.find((p) => p.id === c.personId && !p.archivedAt)
    : null;
  if (c.personId && !person)
    throw Error(
      "Исполнитель отсутствует или архивирован. Выберите действующую карточку",
    );
  const old = d.assignments.find(
      (a) => a.kind === c.kind && a.targetId === c.targetId,
    ),
    active = old ? activeAssignment(old, people) : undefined,
    role = c.roleLabel.trim();
  if (
    (active?.personId ?? null) === c.personId &&
    (active?.roleLabel ?? "") === role
  )
    return;
  d.assignments = d.assignments.filter(
    (a) => !(a.kind === c.kind && a.targetId === c.targetId),
  );
  if (c.personId || role)
    d.assignments.push({
      id: c.id,
      workspaceId: d.project.workspaceId,
      projectId: d.project.id,
      kind: c.kind,
      targetId: c.targetId,
      personId: c.personId,
      roleLabel: role,
      personSnapshot: person ? fullName(person) : "",
      revision: 0,
    });
}
