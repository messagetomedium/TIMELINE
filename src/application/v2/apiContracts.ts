import { z } from "zod";
import { dateOnlySchema, viewPreferencesSchema } from "../../domain/schema";

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
export const viewSchema = z.strictObject({ workspaceId: z.uuid(), value: viewPreferencesSchema });

export type CreateProject = z.infer<typeof createProjectSchema>;
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;
export const commandResultSchema = z.object({
  commandId: z.uuid(), projectId: z.uuid().nullable(), revision: z.number().int().nonnegative(),
  workspaceRevision: z.number().int().nonnegative(), peopleRevision: z.number().int().nonnegative(), changed: z.boolean(),
});
export type CommandResult = z.infer<typeof commandResultSchema>;
