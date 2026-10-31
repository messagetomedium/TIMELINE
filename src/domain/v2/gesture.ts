import type { TimelineCommand } from "../legacyCommands";
import type { DateOnly } from "../dates";
import type { GroupMove } from './work';
export type GestureCommand =
  | GroupMove
  | TimelineCommand
  | { type: "checkpoint"; id: string; date: DateOnly };
