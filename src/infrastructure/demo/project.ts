import { projectDocumentSchema } from '../../domain';

// Fixed UUIDs, dates and timestamps. Opt-in, in-memory, never a database seed.
export const demoProject = projectDocumentSchema.parse({
  schemaVersion: 1,
  project: {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Осенняя премьера',
    description: 'Подготовка и выпуск короткометражного фильма.',
    anchorDate: '2026-10-01', startDate: '2026-10-01', endDateExclusive: '2026-11-01',
    sortIndex: 0, revision: 0, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z',
  },
  stageMarkers: [
    { id: '20000000-0000-4000-8000-000000000001', projectId: '10000000-0000-4000-8000-000000000001', title: 'Сценарий утверждён', date: '2026-10-08', sortIndex: 0 },
    { id: '20000000-0000-4000-8000-000000000002', projectId: '10000000-0000-4000-8000-000000000001', title: 'Премьера', date: '2026-10-30', sortIndex: 1 },
  ],
  lanes: [
    { id: '30000000-0000-4000-8000-000000000001', projectId: '10000000-0000-4000-8000-000000000001', kind: 'process', processId: null, sortIndex: 0 },
    { id: '30000000-0000-4000-8000-000000000002', projectId: '10000000-0000-4000-8000-000000000001', kind: 'task', processId: '40000000-0000-4000-8000-000000000001', sortIndex: 0 },
    { id: '30000000-0000-4000-8000-000000000003', projectId: '10000000-0000-4000-8000-000000000001', kind: 'task', processId: '40000000-0000-4000-8000-000000000002', sortIndex: 0 },
  ],
  processes: [
    { id: '40000000-0000-4000-8000-000000000001', projectId: '10000000-0000-4000-8000-000000000001', laneId: '30000000-0000-4000-8000-000000000001', title: 'Подготовка', startDate: '2026-10-01', endDateExclusive: '2026-10-10', color: '#526e63', status: 'Готово', sortIndex: 0, revision: 0 },
    { id: '40000000-0000-4000-8000-000000000002', projectId: '10000000-0000-4000-8000-000000000001', laneId: '30000000-0000-4000-8000-000000000001', title: 'Производство', startDate: '2026-10-10', endDateExclusive: '2026-10-31', color: '#816a9c', status: 'В работе', sortIndex: 1, revision: 0 },
  ],
  tasks: [
    { id: '50000000-0000-4000-8000-000000000001', processId: '40000000-0000-4000-8000-000000000001', laneId: '30000000-0000-4000-8000-000000000002', title: 'Сценарий и раскадровка', startDate: '2026-10-01', endDateExclusive: '2026-10-08', status: 'Готово', sortIndex: 0, revision: 0 },
    { id: '50000000-0000-4000-8000-000000000002', processId: '40000000-0000-4000-8000-000000000002', laneId: '30000000-0000-4000-8000-000000000003', title: 'Съёмка', startDate: '2026-10-10', endDateExclusive: '2026-10-17', status: 'Готово', sortIndex: 0, revision: 0 },
    { id: '50000000-0000-4000-8000-000000000003', processId: '40000000-0000-4000-8000-000000000002', laneId: '30000000-0000-4000-8000-000000000003', title: 'Монтаж и звук', startDate: '2026-10-17', endDateExclusive: '2026-10-30', status: 'В работе', sortIndex: 1, revision: 0 },
  ],
  people: [
    { id: '60000000-0000-4000-8000-000000000001', displayName: 'Анна Смирнова', defaultRole: 'Продюсер', createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z' },
  ],
  assignments: [
    { id: '70000000-0000-4000-8000-000000000001', projectId: '10000000-0000-4000-8000-000000000001', targetType: 'process', targetId: '40000000-0000-4000-8000-000000000002', personId: '60000000-0000-4000-8000-000000000001', roleLabel: 'Продюсер', isLead: true, sortIndex: 0 },
    { id: '70000000-0000-4000-8000-000000000002', projectId: '10000000-0000-4000-8000-000000000001', targetType: 'task', targetId: '50000000-0000-4000-8000-000000000003', roleLabel: 'Монтажёр', isLead: false, sortIndex: 1 },
  ],
  viewPreferences: {
    projectId: '10000000-0000-4000-8000-000000000001', gridStep: '1w', zoomPxPerDay: 24,
    cameraX: 0, cameraY: 0, showWeekends: true, expandedProcessIds: [], expandedAssigneeGroupIds: [], showPeoplePanel: true,
  },
});
