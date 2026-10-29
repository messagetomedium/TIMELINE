import type { Project, ProjectDocument, ProjectId } from '../domain';

/** Port for future local persistence. No implementation or sync is implied.
 * Writes must be issued by application commands, never by React components.
 */
export interface ProjectRepository {
  list(): Promise<readonly Project[]>;
  load(id: ProjectId): Promise<ProjectDocument | null>;
  /** Atomically save the entire validated aggregate; null means create-only.
   * An existing document must match expectedRevision or reject the write.
   * The command supplies the next revision; the adapter must not silently merge.
   */
  save(document: ProjectDocument, expectedRevision: number | null): Promise<void>;
  /** Atomically delete a project aggregate after checking its revision. */
  delete(id: ProjectId, expectedRevision: number): Promise<void>;
}
