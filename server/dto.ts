import { z } from "zod";
import { dateOnlySchema, viewPreferencesSchema } from "../src/domain/schema";
import { peopleEnvelopeSchema } from "../src/domain/v2/people";

const command = {
  commandId: z.uuid(), version: z.literal(1), workspaceId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
};
export const createProjectSchema = z.strictObject({
  ...command, name: z.string().trim().min(1).max(500),
  description: z.string().max(20_000), startDate: dateOnlySchema,
});
export const workspaceCommandSchema = z.strictObject({
  ...command,
  command: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("ArchiveProject"), id: z.uuid(), archived: z.boolean() }),
    z.strictObject({ type: z.literal("DuplicateProject"), id: z.uuid(), expectedProjectRevision: z.number().int().nonnegative() }),
    z.strictObject({ type: z.literal("ReorderProjects"), order: z.array(z.uuid()).max(1000).refine((ids) => new Set(ids).size === ids.length) }),
  ]),
});
export { peopleEnvelopeSchema };
export const viewSchema = z.strictObject({ workspaceId: z.uuid(), value: viewPreferencesSchema });
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

export type CreateProject = z.infer<typeof createProjectSchema>;
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;

/** Deliberately excludes people, contacts, assignments, preferences, history and auth. */
export const guestProjectSchema = z.strictObject({
  project: z.strictObject({ id: z.uuid(), name: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, revision: z.number().int() }),
  stages: z.array(z.strictObject({ id: z.uuid(), title: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, sortIndex: z.number().int() })),
  processes: z.array(z.strictObject({ id: z.uuid(), stageId: z.uuid(), isActive: z.boolean(), title: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, status: z.string(), color: z.string() })),
  tasks: z.array(z.strictObject({ id: z.uuid(), processId: z.uuid(), isActive: z.boolean(), title: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, status: z.string() })),
  results: z.array(z.strictObject({ id: z.uuid(), stageId: z.uuid(), processId: z.uuid().nullable(), title: z.string() })),
  checkpoints: z.array(z.strictObject({ id: z.uuid(), title: z.string(), date: dateOnlySchema })),
});
