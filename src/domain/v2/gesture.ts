import type { TimelineCommand } from "../legacyCommands";
import type { DateOnly } from "../dates";
export type GestureCommand =
  | TimelineCommand
  | { type: "checkpoint"; id: string; date: DateOnly };
