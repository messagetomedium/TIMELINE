import type { CommandService } from "./CommandService";

/** The existing UI command surface; storage and transaction mechanics stay behind it. */
type Mutations = "execute" | "executeLocal" | "peopleExecute" | "peopleUndo" | "portfolioCommand" | "undo" | "projectCommand";
export type UIService = Pick<CommandService,
  "envelope" | "history" | "create" | "duplicate" | "saveView" | "savePreferences" | "exportBackup" | "previewImport" | "importBackup"
> & { screen: (id: string | null, afterCommand?: boolean) => ReturnType<CommandService["screen"]> } & { [K in Mutations]: (...args: Parameters<CommandService[K]>) => Promise<unknown> };

export interface RecoveryState {
  pending: boolean;
  sending: boolean;
  message: string;
  intent: string;
  conflict: boolean;
  authRequired: boolean;
  drafts: Readonly<Record<string, string>>;
}
export interface ServerRecovery {
  subscribe: (listener: () => void) => () => void;
  getState: () => RecoveryState;
  retry: () => Promise<string | null>;
  reapply: () => Promise<string | null>;
  discard: () => void;
  rememberDraft: (key: string, value: string) => void;
  forgetDraft: (key: string) => void;
  clearDrafts: () => void;
}
