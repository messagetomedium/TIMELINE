import { z } from "zod";
import { peopleEnvelopeSchema } from "../src/domain/v2/people";

export { createProjectSchema, workspaceCommandSchema, viewSchema } from "../src/application/v2/apiContracts";
export type { CreateProject, WorkspaceCommand } from "../src/application/v2/apiContracts";
export { peopleEnvelopeSchema };
export { guestProjectSchema } from "../src/application/v2/accessContracts";
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
