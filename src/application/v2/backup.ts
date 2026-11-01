import { catalogDataSchema } from "../../domain/v2/peopleModel";
import { z } from "zod";
import { snapshotSchema } from "../../domain/v2/model";
import { workspacePreferencesSchema } from "../workspace/model";
export const v2BackupSchema = z.strictObject({
  format: z.literal("timeline-backup"),
  version: z.literal(2),
  exportedAt: z.iso.datetime(),
  documents: z.array(snapshotSchema),
  preferences: workspacePreferencesSchema,
  catalog: catalogDataSchema.optional(),
});
export type V2Backup = z.infer<typeof v2BackupSchema>;
