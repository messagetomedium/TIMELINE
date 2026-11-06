import { z } from "zod";
import { dateOnlySchema } from "../../domain/schema";

export const teamSchema = z.strictObject({
  role: z.enum(["owner", "admin"]),
  limits: z.strictObject({ editors: z.number().int().positive(), guests: z.number().int().positive() }),
  members: z.array(z.strictObject({ id: z.uuid(), name: z.string(), email: z.email(), role: z.enum(["owner", "admin"]) })),
  invitations: z.array(z.strictObject({ id: z.uuid(), email: z.email(), expiresAt: z.iso.datetime(), status: z.enum(["pending", "used", "expired", "revoked"]) })),
});
export const guestLinksSchema = z.strictObject({ links: z.array(z.strictObject({
  id: z.uuid(), projectId: z.uuid(), permissions: z.literal("read"), status: z.enum(["active", "revoked"]),
})) });

/** Shared read-only wire contract. No people, assignments, contacts, history or auth. */
export const guestProjectSchema = z.strictObject({
  project: z.strictObject({ id: z.uuid(), name: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, revision: z.number().int() }),
  stages: z.array(z.strictObject({ id: z.uuid(), title: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, sortIndex: z.number().int() })),
  processes: z.array(z.strictObject({ id: z.uuid(), stageId: z.uuid(), isActive: z.boolean(), title: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, status: z.string(), color: z.string() })),
  tasks: z.array(z.strictObject({ id: z.uuid(), processId: z.uuid(), isActive: z.boolean(), title: z.string(), startDate: dateOnlySchema, endDateExclusive: dateOnlySchema, status: z.string() })),
  results: z.array(z.strictObject({ id: z.uuid(), stageId: z.uuid(), processId: z.uuid().nullable(), title: z.string() })),
  checkpoints: z.array(z.strictObject({ id: z.uuid(), title: z.string(), date: dateOnlySchema })),
});
