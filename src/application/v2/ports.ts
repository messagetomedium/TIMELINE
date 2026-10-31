import type { StoredHistory } from "./history";
import type { ViewPreferences, ProjectId } from "../../domain";
import type { WorkspacePreferences } from "../workspace/model";
import type { Snapshot } from "../../domain/v2/model";
export interface V2RepositoryPort {
  loadHistory(id: string): Promise<StoredHistory | null>;
  commit(
    snapshot: Snapshot,
    expected: number,
    history: StoredHistory,
    expectedHistoryToken: string | null,
    archiveOld: boolean,
  ): Promise<void>;
  all(): Promise<Snapshot[]>;
  preferences(): Promise<WorkspacePreferences>;
  views(): Promise<Record<string, ViewPreferences>>;
  savePreferences(value: WorkspacePreferences): Promise<void>;
  saveView(id: ProjectId, view: ViewPreferences): Promise<void>;
  insertBatch(
    values: Snapshot[],
    preferences?: WorkspacePreferences,
  ): Promise<void>;
  load(id: string): Promise<Snapshot | null>;
  save(snapshot: Snapshot, expected: number | null): Promise<void>;
}
