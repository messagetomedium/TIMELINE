import { daysBetween, projectDocumentSchema, shiftInterval } from "./index";
import type {
  DateOnly,
  ProcessId,
  ProjectDocument,
  StageMarkerId,
  TaskId,
} from "./index";

export type Selection =
  | { readonly kind: "process"; readonly id: ProcessId }
  | { readonly kind: "task"; readonly id: TaskId };
export type TimelineCommand =
  | {
      readonly type: "rename";
      readonly target: Selection;
      readonly title: string;
    }
  | { readonly type: "move"; readonly target: Selection; readonly days: number }
  | {
      readonly type: "resize";
      readonly target: Selection;
      readonly edge: "start" | "end";
      readonly date: DateOnly;
    }
  | {
      readonly type: "stage";
      readonly id: StageMarkerId;
      readonly date: DateOnly;
    };
export type CommandResult =
  | { readonly ok: true; readonly document: ProjectDocument }
  | { readonly ok: false; readonly error: string };

/** Pure, atomic operations shared by preview and commit. No writes on pointermove. */
export function applyTimelineCommand(
  document: ProjectDocument,
  command: TimelineCommand,
): CommandResult {
  try {
    let processes = [...document.processes];
    let tasks = [...document.tasks];
    let stageMarkers = [...document.stageMarkers];
    if (command.type === "stage") {
      if (!stageMarkers.some((stage) => stage.id === command.id))
        return { ok: false, error: "Граница этапа не найдена." };
      stageMarkers = stageMarkers.map((stage) =>
        stage.id === command.id ? { ...stage, date: command.date } : stage,
      );
    } else {
      const target =
        command.target.kind === "process"
          ? processes.find((item) => item.id === command.target.id)
          : tasks.find((item) => item.id === command.target.id);
      if (!target) return { ok: false, error: "Элемент не найден." };
      let updated = { ...target, revision: target.revision + 1 };
      if (command.type === "rename") {
        const title = command.title.trim();
        if (!title)
          return { ok: false, error: "Название не может быть пустым." };
        updated = { ...updated, title };
      } else if (command.type === "move") {
        updated = { ...updated, ...shiftInterval(target, command.days) };
        if (command.target.kind === "process") {
          tasks = tasks.map((task) =>
            task.processId === target.id
              ? {
                  ...task,
                  ...shiftInterval(task, command.days),
                  revision: task.revision + 1,
                }
              : task,
          );
        }
      } else {
        updated = {
          ...updated,
          ...(command.edge === "start"
            ? { startDate: command.date }
            : { endDateExclusive: command.date }),
        };
        if (daysBetween(updated.startDate, updated.endDateExclusive) < 1)
          return {
            ok: false,
            error: "Длительность должна быть не меньше одного дня.",
          };
      }
      if (command.target.kind === "process") {
        processes = processes.map((process) =>
          process.id === updated.id
            ? { ...process, ...updated, id: process.id }
            : process,
        );
      } else {
        tasks = tasks.map((task) =>
          task.id === updated.id ? { ...task, ...updated, id: task.id } : task,
        );
        // A moved or expanded child grows its parent; shrinking never removes slack.
        if (command.type !== "rename" && "processId" in target) {
          processes = processes.map((process) => {
            if (process.id !== target.processId) return process;
            const startDate =
              updated.startDate < process.startDate
                ? updated.startDate
                : process.startDate;
            const endDateExclusive =
              updated.endDateExclusive > process.endDateExclusive
                ? updated.endDateExclusive
                : process.endDateExclusive;
            return startDate === process.startDate &&
              endDateExclusive === process.endDateExclusive
              ? process
              : {
                  ...process,
                  startDate,
                  endDateExclusive,
                  revision: process.revision + 1,
                };
          });
        }
      }
    }
    const parsed = projectDocumentSchema.safeParse({
      ...document,
      processes,
      tasks,
      stageMarkers,
      project: { ...document.project, revision: document.project.revision + 1 },
    });
    if (!parsed.success) {
      const message = parsed.error.issues.some((issue) =>
        issue.message.includes("overlap"),
      )
        ? "На этой дорожке уже есть работа в выбранные даты."
        : parsed.error.issues.some((issue) => issue.path[0] === "stageBands")
          ? "Граница не может пересечь соседний этап."
          : "Границы процесса должны вмещать все задачи. Изменение не применено.";
      return { ok: false, error: message };
    }
    return { ok: true, document: parsed.data };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return {
      ok: false,
      error: "Дата выходит за допустимый календарный диапазон.",
    };
  }
}
