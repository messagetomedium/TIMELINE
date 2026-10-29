import { z } from 'zod';

const uuidSchema = z.uuid().transform((value) => value.toLowerCase());

export const projectIdSchema = uuidSchema.brand<'ProjectId'>();
export const stageMarkerIdSchema = uuidSchema.brand<'StageMarkerId'>();
export const stageBandIdSchema = uuidSchema.brand<'StageBandId'>();
export const laneIdSchema = uuidSchema.brand<'LaneId'>();
export const processIdSchema = uuidSchema.brand<'ProcessId'>();
export const taskIdSchema = uuidSchema.brand<'TaskId'>();
export const personIdSchema = uuidSchema.brand<'PersonId'>();
export const assignmentIdSchema = uuidSchema.brand<'AssignmentId'>();

export type ProjectId = z.infer<typeof projectIdSchema>;
export type StageMarkerId = z.infer<typeof stageMarkerIdSchema>;
export type StageBandId = z.infer<typeof stageBandIdSchema>;
export type LaneId = z.infer<typeof laneIdSchema>;
export type ProcessId = z.infer<typeof processIdSchema>;
export type TaskId = z.infer<typeof taskIdSchema>;
export type PersonId = z.infer<typeof personIdSchema>;
export type AssignmentId = z.infer<typeof assignmentIdSchema>;
