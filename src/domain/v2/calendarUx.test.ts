import { describe, it, expect } from "vitest";
import { dateOnly, addDays } from "../dates";
import {
  chooseRangeDate,
  parseDate,
  formatDate,
  monthCells,
} from "../dateRange";
import { barGeometry } from "../barGeometry";
import { timeFragments } from "../SegmentAxis";
import { createTemplate } from "./template";
import { applyCommand } from "./commands";
import { required } from "../../testing/required";
const D = dateOnly;
const make = () =>
  createTemplate(
    "Проверка",
    "",
    D("2026-11-02"),
    () => crypto.randomUUID(),
    "2026-10-31T12:00:00Z",
  );
describe("range calendar selection", () => {
  it("parses only real DD.MM.YYYY dates, including leap days", () => {
    expect(parseDate("29.02.2028")).toBe("2028-02-29");
    expect(formatDate(D("0001-01-01"))).toBe("01.01.0001");
    for (const s of ["29.02.2027", "31.04.2026", "2026-11-02", "2.11.2026"])
      expect(() => parseDate(s)).toThrow();
  });
  it("selects, clears one endpoint, fills the missing one and normalizes reverse dates", () => {
    const a = D("2026-11-02"),
      b = D("2026-11-15"),
      c = D("2026-11-20");
    expect(chooseRangeDate({ start: null, end: null }, b)).toEqual({
      start: b,
      end: null,
    });
    expect(chooseRangeDate({ start: b, end: null }, a)).toEqual({
      start: a,
      end: b,
    });
    expect(chooseRangeDate({ start: a, end: b }, a)).toEqual({
      start: null,
      end: b,
    });
    expect(chooseRangeDate({ start: null, end: b }, c)).toEqual({
      start: b,
      end: c,
    });
    expect(chooseRangeDate({ start: a, end: b }, b)).toEqual({
      start: a,
      end: null,
    });
    expect(chooseRangeDate({ start: a, end: b }, c)).toEqual({
      start: c,
      end: null,
    });
  });
  it("lays out a Monday-first month continuously across years and calendar limits", () => {
    const cells = monthCells(D("2027-01-01"));
    expect(cells).toHaveLength(42);
    expect(cells[0]).toBe("2026-12-28");
    expect(cells[4]).toBe("2027-01-01");
    expect(monthCells(D("0001-01-01"))[0]).toBe("0001-01-01");
    expect(monthCells(D("9999-12-01")).some((x) => x === null)).toBe(true);
  });
});
describe("decorative spacing and temporal fills", () => {
  const a = {
      id: "a",
      y: 18,
      startDate: D("2026-11-02"),
      endDateExclusive: D("2026-11-06"),
    },
    b = {
      id: "b",
      y: 18,
      startDate: D("2026-11-06"),
      endDateExclusive: D("2026-11-08"),
    };
  it("creates 8px between mixed touching bars without changing calendar edges", () => {
    const cam = { originDate: a.startDate, panX: 0, pxPerDay: 30 },
      ga = barGeometry(a, [a, b], cam),
      gb = barGeometry(b, [a, b], cam);
    expect(gb.left - ga.left - ga.width).toBe(8);
    expect(ga.timeEnd).toBe(gb.timeStart);
    expect(ga.timeEnd).toBe(120);
    expect(a.endDateExclusive).toBe(b.startDate);
  });
  it("adapts at low zoom, and does not space other rows or already separated dates", () => {
    const cam = { originDate: a.startDate, panX: 30, pxPerDay: 4 },
      ga = barGeometry(a, [a, b], cam),
      gb = barGeometry(b, [a, b], cam);
    expect(gb.left - ga.left - ga.width).toBeCloseTo(1.8);
    expect(barGeometry(a, [a, { ...b, y: 40 }], cam).endInset).toBe(0);
    expect(
      barGeometry(a, [a, { ...b, startDate: D("2026-11-07") }], cam).endInset,
    ).toBe(0);
  });
  it("uses real gaps at stage boundaries rather than adding decorative calendar time", () => {
    const cam = {
      originDate: a.startDate,
      panX: 50,
      pxPerDay: 24,
      gaps: [{ stageId: "s", boundary: b.startDate, width: 260 }],
    };
    expect(barGeometry(a, [a, b], cam).endInset).toBe(0);
    expect(barGeometry(b, [a, b], cam).startInset).toBe(0);
    const fragments = timeFragments(
      { startDate: a.startDate, endDateExclusive: b.endDateExclusive },
      cam,
    );
    expect(fragments).toHaveLength(2);
    expect(fragments.reduce((n, f) => n + f.width, 0)).toBe(6 * 24);
    expect(
      required(fragments[1]).x -
        required(fragments[0]).x -
        required(fragments[0]).width,
    ).toBe(260);
  });
});
describe("atomic date inspectors", () => {
  it("resizes both project edges in one plan without shifting work or free checkpoints", () => {
    const d = make(),
      next = applyCommand(d, {
        type: "ResizeProjectRange",
        startDate: addDays(d.project.startDate, -4),
        endDateExclusive: addDays(d.project.endDateExclusive, 6),
      });
    expect(next.processes).toEqual(d.processes);
    expect(next.tasks).toEqual(d.tasks);
    expect(next.checkpoints).toEqual(d.checkpoints);
    expect(required(next.stages[0]).startDate).toBe(next.project.startDate);
    expect(required(next.stages.at(-1)).endDateExclusive).toBe(
      next.project.endDateExclusive,
    );
    expect(next.project.revision).toBe(1);
  });
  it("rejects work cropping, stage inversion, empty dates and preserves no-op identity", () => {
    const d = make();
    expect(() =>
      applyCommand(d, {
        type: "ResizeProjectRange",
        startDate: addDays(d.project.startDate, 1),
        endDateExclusive: d.project.endDateExclusive,
      }),
    ).toThrow("обрезают");
    expect(() =>
      applyCommand(d, {
        type: "ResizeProjectRange",
        startDate: d.project.endDateExclusive,
        endDateExclusive: d.project.endDateExclusive,
      }),
    ).toThrow();
    expect(
      applyCommand(d, {
        type: "ResizeProjectRange",
        startDate: d.project.startDate,
        endDateExclusive: d.project.endDateExclusive,
      }),
    ).toBe(d);
  });
  it("resizes both task edges through the ripple planner and rejects process child cropping", () => {
    const d = make(),
      t = required(d.tasks[0]),
      p = required(d.processes[0]);
    const next = applyCommand(d, {
      type: "ResizeWorkRange",
      kind: "task",
      id: t.id,
      startDate: addDays(t.startDate, -1),
      endDateExclusive: addDays(t.endDateExclusive, 1),
    });
    expect(required(next.tasks[0]).startDate).toBe(addDays(t.startDate, -1));
    expect(required(next.tasks[1]).startDate).toBe(
      addDays(t.endDateExclusive, 1),
    );
    expect(() =>
      applyCommand(d, {
        type: "ResizeWorkRange",
        kind: "process",
        id: p.id,
        startDate: addDays(p.startDate, 1),
        endDateExclusive: p.endDateExclusive,
      }),
    ).toThrow();
    expect(
      applyCommand(d, {
        type: "SetWorkStatus",
        kind: "task",
        id: t.id,
        status: t.status,
      }),
    ).toBe(d);
  });
});
