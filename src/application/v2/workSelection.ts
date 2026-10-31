import type { Snapshot } from "../../domain/v2/model";
import { selectedWorks, workParent } from "../../domain/v2/work";
import type { WorkKind } from "../../domain/v2/work";
export interface WorkSelection {
  kind: WorkKind;
  ids: string[];
  anchor: string;
}
export function selectWork(
  d: Snapshot,
  current: WorkSelection | null,
  kind: WorkKind,
  id: string,
  modifier: "plain" | "toggle" | "range",
): WorkSelection | null {
  if (modifier === "plain" || !current) return { kind, ids: [id], anchor: id };
  const clicked = selectedWorks(d, kind, [id])[0],
    active = selectedWorks(d, current.kind, current.ids)[0];
  if (
    !clicked ||
    !active ||
    current.kind !== kind ||
    workParent(clicked) !== workParent(active)
  )
    throw Error("Выбирайте процессы одного этапа или задачи одного процесса");
  if (modifier === "toggle") {
    const ids = current.ids.includes(id)
      ? current.ids.filter((x) => x !== id)
      : [...current.ids, id];
    return ids.length
      ? { kind, ids, anchor: ids.includes(id) ? id : (ids.at(-1) ?? id) }
      : null;
  }
  const list = (kind === "process" ? d.processes : d.tasks).filter(
    (x) => workParent(x) === workParent(clicked),
  );
  const lanes = d.lanes
    .filter((l) => list.some((x) => x.laneId === l.id))
    .sort((a, b) => a.sortIndex - b.sortIndex || a.id.localeCompare(b.id));
  list.sort(
    (a, b) =>
      lanes.findIndex((l) => l.id === a.laneId) -
        lanes.findIndex((l) => l.id === b.laneId) ||
      a.startDate.localeCompare(b.startDate) ||
      a.id.localeCompare(b.id),
  );
  const a = list.findIndex((x) => x.id === current.anchor),
    b = list.findIndex((x) => x.id === id);
  return {
    kind,
    ids: list
      .slice(Math.min(a < 0 ? b : a, b), Math.max(a, b) + 1)
      .map((x) => x.id),
    anchor: current.anchor,
  };
}
