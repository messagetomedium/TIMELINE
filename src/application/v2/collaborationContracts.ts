import { z } from "zod";
import { commandResultSchema } from "./apiContracts";

export const counterSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const cursorSchema = z.strictObject({ workspaceId: z.uuid(), userId: z.string().min(1), sequence: counterSchema });
/** Revision metadata only. Private write sets stay in PostgreSQL, never on the stream. */
export const changeSchema = z.strictObject({
  sequence: counterSchema, workspaceId: z.uuid(), projectId: z.uuid().nullable(), commandId: z.uuid().nullable(),
  revision: counterSchema, workspaceRevision: counterSchema, peopleRevision: counterSchema,
});
export type Change = z.infer<typeof changeSchema>;
export const leaseProofSchema = z.strictObject({ id: z.uuid(), fence: counterSchema });
export type LeaseProof = z.infer<typeof leaseProofSchema>;
export const leaseGrantSchema = leaseProofSchema.extend({ expiresAt: z.iso.datetime(), baseRevision: counterSchema });
export const leasePreparedSchema = z.union([z.strictObject({ lease: leaseGrantSchema }), z.strictObject({ receipt: commandResultSchema })]);
export const leaseActionSchema = z.strictObject({ commandId: z.uuid(), fence: counterSchema });
