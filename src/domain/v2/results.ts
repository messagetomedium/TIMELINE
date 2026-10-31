import { z } from "zod";
import { processIdSchema } from "../ids";
import type { Snapshot, Result } from "./model";

export const resultCommands = [
  z.strictObject({
    type: z.literal("UpdateResult"),
    id: z.uuid(),
    stageId: z.uuid(),
    processId: processIdSchema.nullable(),
    field: z.enum(["title", "description"]),
    value: z.string(),
  }),
  z.strictObject({
    type: z.literal("CreateStandaloneResult"),
    id: z.uuid(),
    stageId: z.uuid(),
    title: z.string().trim().min(1),
  }),
  z.strictObject({
    type: z.literal("SetResultPlaced"),
    id: z.uuid(),
    placed: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("MoveResult"),
    id: z.uuid(),
    y: z.number().nonnegative(),
  }),
  z.strictObject({ type: z.literal("DeleteResult"), id: z.uuid() }),
] as const;
export type ResultCommand = z.infer<(typeof resultCommands)[number]>;
export function isResultPlaced(d: Snapshot, r: Result) {
  return (
    !!r.title.trim() &&
    (d.resultPlacements.find((p) => p.resultId === r.id)?.isPlaced ?? true)
  );
}
export function applyResult(d: Snapshot, c: ResultCommand) {
  let r = d.results.find((x) => x.id === c.id);
  if (
    c.type === "UpdateResult" &&
    r &&
    r[c.field] === (c.field === "title" ? c.value.trim() : c.value)
  )
    return;
  if (c.type === "SetResultPlaced" && r && isResultPlaced(d, r) === c.placed)
    return;
  if (c.type === "UpdateResult" || c.type === "CreateStandaloneResult") {
    if (!d.stages.some((s) => s.id === c.stageId))
      throw Error("Этап результата не найден");
    if (!r) {
      if (c.type === "UpdateResult" && !c.value.trim()) return;
      r = {
        id: c.id,
        projectId: d.project.id,
        workspaceId: d.project.workspaceId,
        stageId: c.stageId,
        processId: c.type === "UpdateResult" ? c.processId : null,
        title: "",
        description: "",
        revision: 0,
      };
      d.results.push(r);
    } else if (
      c.type === "CreateStandaloneResult" ||
      r.stageId !== c.stageId ||
      r.processId !== c.processId
    )
      throw Error("Принадлежность результата изменилась");
    if (c.type === "UpdateResult")
      r[c.field] = c.field === "title" ? c.value.trim() : c.value;
    else r.title = c.title;
  } else if (!r) throw Error("Результат не найден");
  if (c.type === "DeleteResult") {
    if (r.processId)
      throw Error("Связанный результат можно скрыть, сохранив текст");
    d.results = d.results.filter((x) => x.id !== c.id);
    d.resultPlacements = d.resultPlacements.filter((x) => x.resultId !== c.id);
    return;
  }
  let p = d.resultPlacements.find((x) => x.resultId === c.id);
  if (!p) {
    p = {
      workspaceId: d.project.workspaceId,
      projectId: d.project.id,
      resultId: c.id,
      isPlaced: !!r.title.trim(),
      hiddenByUser: false,
      layoutMode: "auto",
      sortIndex: d.resultPlacements.length,
      manualY: 0,
      revision: 0,
    };
    d.resultPlacements.push(p);
  }
  if (c.type === "SetResultPlaced") {
    if (c.placed && !r.title.trim())
      throw Error("Сначала заполните название результата");
    p.isPlaced = c.placed;
    p.hiddenByUser = !c.placed;
  } else if (c.type === "MoveResult") {
    if (!isResultPlaced(d, r)) throw Error("Результат скрыт");
    p.layoutMode = "manual";
    p.manualY = c.y;
  } else p.isPlaced = !!r.title.trim() && !p.hiddenByUser;
}
export const RESULT_TILE_HEIGHT = 56;
/** Deterministic scene shared by columns; manual placements reserve their positions first. */
export function resultLayout(
  d: Snapshot,
  processY: ReadonlyMap<string, number>,
) {
  return d.stages.flatMap((s) => {
    const rs = d.results.filter(
      (r) => r.stageId === s.id && isResultPlaced(d, r),
    );
    const positions = new Map<string, number>();
    const manual = rs
      .flatMap((r) => {
        const p = d.resultPlacements.find((p) => p.resultId === r.id);
        return p?.layoutMode === "manual" ? [{ r, p }] : [];
      })
      .sort(
        (a, b) =>
          a.p.manualY - b.p.manualY ||
          a.p.sortIndex - b.p.sortIndex ||
          a.r.id.localeCompare(b.r.id),
      );
    let bottom = 0;
    for (const { r, p } of manual) {
      const y = Math.max(bottom, p.manualY);
      positions.set(r.id, y);
      bottom = y + RESULT_TILE_HEIGHT + 8;
    }
    for (const r of rs) {
      if (positions.has(r.id)) continue;
      let y = r.processId ? (processY.get(r.processId) ?? 18) : 18;
      while (
        [...positions.values()].some(
          (v) =>
            y < v + RESULT_TILE_HEIGHT + 8 && y + RESULT_TILE_HEIGHT + 8 > v,
        )
      )
        y = Math.max(
          ...[...positions.values()]
            .filter(
              (v) =>
                y < v + RESULT_TILE_HEIGHT + 8 &&
                y + RESULT_TILE_HEIGHT + 8 > v,
            )
            .map((v) => v + RESULT_TILE_HEIGHT + 8),
        );
      positions.set(r.id, y);
    }
    return rs.map((r) => ({
      result: r,
      y: positions.get(r.id) ?? 18,
      height: RESULT_TILE_HEIGHT,
    }));
  });
}
