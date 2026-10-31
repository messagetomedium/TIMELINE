import { expect, it } from "vitest";
import { selectWork } from "./workSelection";
import { createTemplate } from "../../domain/v2/template";
import { dateOnly } from "../../domain";
import { required } from "../../testing/required";
const doc = () =>
  createTemplate(
    "Выбор",
    "",
    dateOnly("2026-11-02"),
    () => crypto.randomUUID(),
    "2026-10-31T12:00:00Z",
  );
it("Ctrl/Cmd toggle only selection and Shift fills a stable ordered range without mutating the document", () => {
  const d = doc(),
    before = structuredClone(d),
    a = required(d.tasks[0]),
    b = required(d.tasks[1]);
  let s = selectWork(d, null, "task", a.id, "plain");
  s = selectWork(d, s, "task", b.id, "toggle");
  expect(s?.ids).toEqual([a.id, b.id]);
  s = selectWork(d, s, "task", a.id, "toggle");
  expect(s?.ids).toEqual([b.id]);
  s = selectWork(d, s, "task", a.id, "range");
  expect(s?.ids).toEqual([a.id, b.id]);
  expect(d).toEqual(before);
});
it("rejects mixed kinds, processes from different stages, and tasks from different source processes", () => {
  const d = doc(),
    a = required(d.processes[0]),
    b = required(d.processes[2]),
    t = required(d.tasks[0]),
    other = required(d.tasks[2]);
  const s = selectWork(d, null, "process", a.id, "plain");
  expect(() => selectWork(d, s, "process", b.id, "toggle")).toThrow();
  expect(() => selectWork(d, s, "task", t.id, "toggle")).toThrow();
  expect(() =>
    selectWork(
      d,
      selectWork(d, null, "task", t.id, "plain"),
      "task",
      other.id,
      "range",
    ),
  ).toThrow();
});
it("plain selection starts a new scope; toggling the last item clears selection", () => {
  const d = doc(),
    a = required(d.processes[0]),
    b = required(d.processes[2]);
  let s = selectWork(d, null, "process", a.id, "plain");
  s = selectWork(d, s, "process", b.id, "plain");
  expect(s?.ids).toEqual([b.id]);
  expect(selectWork(d, s, "process", b.id, "toggle")).toBeNull();
});
