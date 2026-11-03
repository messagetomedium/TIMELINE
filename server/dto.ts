import { z } from "zod";
import { dateOnlySchema } from "../src/domain/schema";
import { peopleEnvelopeSchema } from "../src/domain/v2/people";

export { createProjectSchema, workspaceCommandSchema, viewSchema } from "../src/application/v2/apiContracts";
export type { CreateProject, WorkspaceCommand } from "../src/application/v2/apiContracts";
export { peopleEnvelopeSchema };
export const inviteSchema = z.strictObject({ email: z.email().max(254).transform((s) => s.toLowerCase()) });
export const tokenSchema = z.strictObject({ token: z.string().regex(/^[\w-]{43}$/) });
export const idParams = z.strictObject({ id: z.uuid() });

/** Body-size and recursive bounds also cover the existing planner's text DTOs. */
export function boundedInput(value: unknown, depth = 0): void {
  if (depth > 16) throw Error("INPUT_LIMIT");
  if (typeof value === "string" && value.length > 20_000) throw Error("INPUT_LIMIT");
  if (Array.isArray(value)) {
    if (value.length > 5000) throw Error("INPUT_LIMIT");
    for (const v of value) boundedInput(v, depth + 1);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) boundedInput(v, depth + 1);
  }
}


/** Deliberately excludes people, contacts, assignments, preferences, history and auth. */
export const guestProjectSchema = z.strictObject({
  project: z.strictObject({ id: z.uuid(), name: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, revision: z.number().int() }),
  stages: z.array(z.strictObject({ id: z.uuid(), title: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, sortIndex: z.number().int() })),
  processes: z.array(z.strictObject({ id: z.uuid(), stageId: z.uuid(), isActive: z.boolean(), title: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, status: z.string(), color: z.string() })),
  tasks: z.array(z.strictObject({ id: z.uuid(), processId: z.uuid(), isActive: z.boolean(), title: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, status: z.string() })),
  results: z.array(z.strictObject({ id: z.uuid(), stageId: z.uuid(), processId: z.uuid().nullable(), title: z.string() })),
  checkpoints: z.array(z.strictObject({ id: z.uuid(), title: z.string(), date: dateOnlySchema })),
});
