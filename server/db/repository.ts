import { and, eq } from "drizzle-orm";
import type { QueryDatabase } from "./connection";
import * as t from "./schema";
import { snapshotSchema } from "../../src/domain/v2/model";
import type { Snapshot } from "../../src/domain/v2/model";
import { emptyCatalog, catalogSchema } from "../../src/domain/v2/peopleModel";
import type { CatalogState } from "../../src/domain/v2/peopleModel";
import type { V2RepositoryPort } from "../../src/application/v2/ports";
import { projectSummarySchema } from "../../src/application/v2/portfolio";
import { ApiError } from "../errors";
const iso = (value:Date|null) => value?.toISOString() ?? null;
export class PostgresRepository implements Pick<V2RepositoryPort,"load"|"summaries"|"loadCatalog"> {
  constructor(readonly db:QueryDatabase,readonly workspaceId:string,readonly actorId:string) {}
  async summaries(limit = 1000, offset = 0) {
    const rows=await this.db.select().from(t.projects).where(eq(t.projects.workspaceId,this.workspaceId)).orderBy(t.projects.sortIndex,t.projects.id).limit(limit).offset(offset);
    return rows.map((p)=>projectSummarySchema.parse({project:this.project(p)}));
  }
  private project(p:typeof t.projects.$inferSelect) {
    return { id:p.id,workspaceId:p.workspaceId,name:p.name,description:p.description,anchorDate:p.anchorDate,startDate:p.startDate,endDateExclusive:p.endDateExclusive,sortIndex:p.sortIndex,isScheduled:p.isScheduled,archivedAt:iso(p.archivedAt),visibility:p.visibility,revision:p.revision,createdAt:p.createdAt.toISOString(),updatedAt:p.updatedAt.toISOString() };
  }
  async loadCatalog():Promise<CatalogState> {
    const [workspace]=await this.db.select().from(t.workspaces).where(eq(t.workspaces.id,this.workspaceId));
    if(!workspace)throw new ApiError(404,"NOT_FOUND");
    const persons=await this.db.select().from(t.people).where(eq(t.people.workspaceId,this.workspaceId)).orderBy(t.people.id);
    const retired=await this.db.select().from(t.assignmentHistory).where(eq(t.assignmentHistory.workspaceId,this.workspaceId)).orderBy(t.assignmentHistory.assignmentId);
    return catalogSchema.parse({...emptyCatalog(this.workspaceId),revision:workspace.peopleRevision,people:persons.map((p)=>({...p,archivedAt:iso(p.archivedAt)})),retiredAssignments:retired.map((r)=>({...r,changedAt:r.changedAt.toISOString()}))});
  }
  async saveCatalog(c:CatalogState) {
    if(c.workspaceId!==this.workspaceId)throw new ApiError(403,"FORBIDDEN");
    for(const person of c.people) {
      const value={...person,archivedAt:person.archivedAt?new Date(person.archivedAt):null};
      const rows = await this.db.insert(t.people).values(value).onConflictDoUpdate({target:t.people.id,set:value,setWhere:eq(t.people.workspaceId,this.workspaceId)}).returning({id:t.people.id});
      if (rows.length !== 1) throw new ApiError(409,"CONFLICT");
    }
    for(const r of c.retiredAssignments)await this.db.insert(t.assignmentHistory).values({...r,changedAt:new Date(r.changedAt)}).onConflictDoNothing();
    await this.db.update(t.workspaces).set({peopleRevision:c.revision}).where(eq(t.workspaces.id,this.workspaceId));
  }
  async load(id:string):Promise<Snapshot|null> {
    const [p]=await this.db.select().from(t.projects).where(and(eq(t.projects.workspaceId,this.workspaceId),eq(t.projects.id,id)));
    if(!p)return null;
    // Only the selected aggregate is loaded. Scope is present on every query.
    const scope = {workspaceId:this.workspaceId,projectId:id};
    const stageRows=await this.db.select().from(t.stages).where(and(eq(t.stages.workspaceId,scope.workspaceId),eq(t.stages.projectId,id))).orderBy(t.stages.sortIndex);
    const pl=await this.db.select().from(t.processLanes).where(and(eq(t.processLanes.workspaceId,scope.workspaceId),eq(t.processLanes.projectId,id))).orderBy(t.processLanes.sortIndex,t.processLanes.id);
    const processes=await this.db.select().from(t.processes).where(and(eq(t.processes.workspaceId,scope.workspaceId),eq(t.processes.projectId,id))).orderBy(t.processes.sortIndex,t.processes.id);
    const tl=await this.db.select().from(t.taskLanes).where(and(eq(t.taskLanes.workspaceId,scope.workspaceId),eq(t.taskLanes.projectId,id))).orderBy(t.taskLanes.sortIndex,t.taskLanes.id);
    const tasks=await this.db.select().from(t.tasks).where(and(eq(t.tasks.workspaceId,scope.workspaceId),eq(t.tasks.projectId,id))).orderBy(t.tasks.sortIndex,t.tasks.id);
    const checkpoints=await this.db.select().from(t.checkpoints).where(and(eq(t.checkpoints.workspaceId,scope.workspaceId),eq(t.checkpoints.projectId,id))).orderBy(t.checkpoints.id);
    const results=await this.db.select().from(t.results).where(and(eq(t.results.workspaceId,scope.workspaceId),eq(t.results.projectId,id))).orderBy(t.results.id);
    const resultPlacements=await this.db.select().from(t.resultPlacements).where(and(eq(t.resultPlacements.workspaceId,scope.workspaceId),eq(t.resultPlacements.projectId,id))).orderBy(t.resultPlacements.sortIndex,t.resultPlacements.resultId);
    const assignments=await this.db.select().from(t.assignments).where(and(eq(t.assignments.workspaceId,scope.workspaceId),eq(t.assignments.projectId,id))).orderBy(t.assignments.id);
    const [view]=await this.db.select().from(t.viewPreferences).where(and(eq(t.viewPreferences.workspaceId,this.workspaceId),eq(t.viewPreferences.userId,this.actorId),eq(t.viewPreferences.scope,`project:${id}`)));
    return snapshotSchema.parse({schemaVersion:2,project:this.project(p),stages:stageRows,lanes:[...pl.map((l)=>({...l,kind:"process",processId:null})),...tl.map((l)=>({...l,kind:"task"}))],processes,tasks,results,resultPlacements,checkpoints:checkpoints.map(({anchor,date,...c})=>({...c,timing:anchor==="free"?{anchor,date}:{anchor}})),assignments:assignments.map(({processId,taskId,...a})=>({...a,kind:processId?"process":"task",targetId:processId??taskId})),viewPreferences:view?.value??{projectId:id,gridStep:"1w",zoomPxPerDay:48,cameraX:48,cameraY:0,showWeekends:true,expandedProcessIds:[],expandedAssigneeGroupIds:[],showPeoplePanel:true}});
  }
  async write(d:Snapshot,expected:number|null) {
    const parsed=snapshotSchema.parse(d);
    if(parsed.project.workspaceId!==this.workspaceId)throw new ApiError(403,"FORBIDDEN");
    const project={...parsed.project,description:parsed.project.description??"",archivedAt:parsed.project.archivedAt?new Date(parsed.project.archivedAt):null,createdAt:new Date(parsed.project.createdAt),updatedAt:new Date(parsed.project.updatedAt),scheduleRevision:parsed.project.revision};
    if(expected===null) {
      await this.db.insert(t.projects).values({...project,creatorId:this.actorId});
      await this.db.insert(t.projectAccess).values({workspaceId:this.workspaceId,projectId:d.project.id,userId:this.actorId,role:"author"});
    } else {
      const rows=await this.db.update(t.projects).set(project).where(and(eq(t.projects.workspaceId,this.workspaceId),eq(t.projects.id,d.project.id),eq(t.projects.revision,expected))).returning({id:t.projects.id});
      if(rows.length!==1)throw new ApiError(409,"REVISION_CONFLICT");
    }
    // Rebuild only the server-planned aggregate, inside the caller's transaction.
    // No client snapshot endpoint exists. Dependency order enforces all scoped FKs.
    const id=d.project.id;
    await this.db.delete(t.assignments).where(and(eq(t.assignments.workspaceId,this.workspaceId),eq(t.assignments.projectId,id)));
    await this.db.delete(t.resultPlacements).where(and(eq(t.resultPlacements.workspaceId,this.workspaceId),eq(t.resultPlacements.projectId,id)));
    await this.db.delete(t.results).where(and(eq(t.results.workspaceId,this.workspaceId),eq(t.results.projectId,id)));
    await this.db.delete(t.checkpoints).where(and(eq(t.checkpoints.workspaceId,this.workspaceId),eq(t.checkpoints.projectId,id)));
    await this.db.delete(t.tasks).where(and(eq(t.tasks.workspaceId,this.workspaceId),eq(t.tasks.projectId,id)));
    await this.db.delete(t.taskLanes).where(and(eq(t.taskLanes.workspaceId,this.workspaceId),eq(t.taskLanes.projectId,id)));
    await this.db.delete(t.processes).where(and(eq(t.processes.workspaceId,this.workspaceId),eq(t.processes.projectId,id)));
    await this.db.delete(t.processLanes).where(and(eq(t.processLanes.workspaceId,this.workspaceId),eq(t.processLanes.projectId,id)));
    await this.db.delete(t.stages).where(and(eq(t.stages.workspaceId,this.workspaceId),eq(t.stages.projectId,id)));
    if(d.stages.length)await this.db.insert(t.stages).values(d.stages);
    const processLanes=d.lanes.filter((l)=>l.kind==="process").map((l)=>({id:l.id,workspaceId:l.workspaceId,projectId:l.projectId,stageId:l.stageId,sortIndex:l.sortIndex}));
    if(processLanes.length)await this.db.insert(t.processLanes).values(processLanes);
    if(d.processes.length)await this.db.insert(t.processes).values(d.processes.map((p)=>({...p,details:p.details??""})));
    const taskLanes=d.lanes.filter((l)=>l.kind==="task").map((l)=>({id:l.id,workspaceId:l.workspaceId,projectId:l.projectId,processId:l.processId,sortIndex:l.sortIndex}));
    if(taskLanes.length)await this.db.insert(t.taskLanes).values(taskLanes);
    if(d.tasks.length)await this.db.insert(t.tasks).values(d.tasks.map((x)=>({...x,details:x.details??""})));
    if(d.checkpoints.length)await this.db.insert(t.checkpoints).values(d.checkpoints.map(({timing,...c})=>({...c,anchor:timing.anchor,date:timing.anchor==="free"?timing.date:null})));
    if(d.results.length)await this.db.insert(t.results).values(d.results);
    if(d.resultPlacements.length)await this.db.insert(t.resultPlacements).values(d.resultPlacements);
    if(d.assignments.length)await this.db.insert(t.assignments).values(d.assignments.map(({kind,targetId,...a})=>({...a,processId:kind==="process"?targetId:null,taskId:kind==="task"?targetId:null})));
    if(expected===null)await this.db.insert(t.viewPreferences).values({workspaceId:this.workspaceId,userId:this.actorId,scope:`project:${id}`,value:d.viewPreferences});
  }
}
