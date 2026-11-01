import type { DateOnly } from "../dates";
import { activeAssignment, fullName } from "./peopleModel";
import type { CatalogData } from "./peopleModel";
import type { Snapshot } from "./model";
export function occupancy(snapshot: Snapshot, catalog: CatalogData) {
  const rows = new Map<
    string,
    {
      id: string;
      name: string;
      role: string;
      segments: {
        startDate: DateOnly;
        endDateExclusive: DateOnly;
        colors: string[];
        targetIds: string[];
        title: string;
      }[];
      items: {
        startDate: DateOnly;
        endDateExclusive: DateOnly;
        id: string;
        color: string;
        title: string;
      }[];
    }
  >();
  for (const a of snapshot.assignments) {
    if (!activeAssignment(a, catalog)) continue;
    const item = (
      a.kind === "process" ? snapshot.processes : snapshot.tasks
    ).find((w) => w.id === a.targetId);
    if (!item) continue;
    const parent = snapshot.processes.find(
      (p) =>
        p.id ===
        (a.kind === "process"
          ? item.id
          : "processId" in item
            ? item.processId
            : ""),
    );
    if (!parent) continue;
    const person = catalog.people.find((p) => p.id === a.personId),
      id = person?.id ?? `role:${a.id}`;
    const row = rows.get(id) ?? {
      id,
      name: person ? fullName(person) : "Не назначен",
      role: person?.defaultRole ?? a.roleLabel,
      items: [],
      segments: [],
    };
    row.items.push({
      ...item,
      color: parent.color,
      title: `${item.title}${a.roleLabel ? ` · ${a.roleLabel}` : ""}`,
    });
    rows.set(id, row);
  }
  for (const row of rows.values()) {
    const boundaries = [
      ...new Set(row.items.flatMap((w) => [w.startDate, w.endDateExclusive])),
    ].sort();
    boundaries.slice(0, -1).forEach((date, i) => {
      const end = boundaries[i + 1];
      if (!end) return;
      const active = row.items.filter(
        (w) => w.startDate < end && date < w.endDateExclusive,
      );
      if (active.length)
        row.segments.push({
          startDate: date,
          endDateExclusive: end,
          colors: [...new Set(active.map((w) => w.color))],
          targetIds: active.map((w) => w.id),
          title: active.map((w) => w.title).join("\n"),
        });
    });
  }
  return [...rows.values()].sort(
    (a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id),
  );
}
