import { laneIdSchema } from "../../domain";
import type { Snapshot } from "../../domain/v2/model";
import { copySourceIds } from "../../domain/v2/work";
import type { WorkKind, WorkCommand } from "../../domain/v2/work";
export function duplicateWorkCommand(
  d: Snapshot,
  kind: WorkKind,
  id: string,
  newId: () => string,
): WorkCommand {
  return {
    type: "DuplicateWork",
    kind,
    id,
    ids: Object.fromEntries(
      copySourceIds(d, kind, id).map((id) => [id, newId()]),
    ),
    newLaneId: laneIdSchema.parse(newId()),
  };
}
