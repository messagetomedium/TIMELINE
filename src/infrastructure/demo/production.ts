import { addDays, dateOnly, projectDocumentSchema } from '../../domain';

const id = (group: number, index: number) => `${String(group).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const projectId = id(11, 1);
const origin = dateOnly('2026-09-01');
const date = (day: number) => addDays(origin, day);
const timestamp = '2026-09-01T09:00:00.000Z';

interface ProductionProcess {
  readonly title: string;
  readonly start: number;
  readonly end: number;
  readonly color: string;
  readonly tasks: readonly (readonly [title: string, start: number, end: number, lane: number])[];
}

const plan: readonly ProductionProcess[] = [
  { title: 'Разработка персонажей', start: 8, end: 160, color: '#8d80ca', tasks: [
    ['Поиск образов', 8, 50, 0], ['Модельные листы', 50, 105, 0], ['Костюмы и палитра', 25, 100, 1], ['Финальные концепты', 105, 150, 2],
  ] },
  { title: 'Мир и локации', start: 22, end: 190, color: '#5c9eaa', tasks: [
    ['Визуальное исследование', 22, 90, 0], ['Дизайн локаций', 90, 180, 0], ['Цветовые ключи', 45, 130, 1], ['Фоны и реквизит', 100, 175, 2],
  ] },
  { title: 'Сценарий и режиссура', start: 0, end: 115, color: '#b99a5d', tasks: [
    ['Литературная основа', 0, 35, 0], ['Сценарий трёх серий', 35, 75, 0], ['Редакторская вычитка', 75, 110, 0], ['Режиссёрская разработка', 20, 105, 1],
  ] },
  { title: 'Раскадровка и аниматик', start: 85, end: 225, color: '#6e9b71', tasks: [
    ['Сториборд первой серии', 85, 140, 0], ['Аниматик первой серии', 140, 190, 0], ['Сториборд второй серии', 100, 170, 1], ['Монтаж аниматика', 175, 220, 2],
  ] },
  { title: 'Анимация серий', start: 140, end: 320, color: '#cb899d', tasks: [
    ['Анимация первой серии', 140, 210, 0], ['Правки первой серии', 210, 255, 0], ['Анимация второй серии', 165, 270, 1], ['Анимация третьей серии', 205, 310, 2],
  ] },
  { title: 'Музыка и звук', start: 200, end: 345, color: '#8eac65', tasks: [
    ['Запись голосов', 200, 250, 0], ['Звуковая атмосфера', 250, 300, 0], ['Оригинальная музыка', 210, 320, 1], ['Финальное сведение', 305, 340, 2],
  ] },
  { title: 'Монтаж и композитинг', start: 245, end: 355, color: '#b88166', tasks: [
    ['Сборка первой серии', 245, 285, 0], ['Композитинг и цвет', 285, 330, 0], ['Заставка и титры', 270, 325, 1], ['Мастер-копия', 330, 350, 2],
  ] },
  { title: 'Выпуск и продвижение', start: 300, end: 365, color: '#718fae', tasks: [
    ['Трейлер и тизеры', 300, 330, 0], ['Пресс-материалы', 330, 355, 0], ['Подготовка премьеры', 310, 360, 1], ['Публикация серий', 355, 365, 2],
  ] },
];

const lanes: unknown[] = [];
const processes: unknown[] = [];
const tasks: unknown[] = [];
const assignments: unknown[] = [];
let taskIndex = 0;
plan.forEach((process, processIndex) => {
  const processId = id(14, processIndex + 1);
  const laneId = id(13, processIndex * 4 + 1);
  lanes.push({ id: laneId, projectId, kind: 'process', processId: null, sortIndex: processIndex });
  for (let row = 0; row < 3; row++) lanes.push({ id: id(13, processIndex * 4 + row + 2), projectId, kind: 'task', processId, sortIndex: row });
  processes.push({ id: processId, projectId, laneId, title: process.title, startDate: date(process.start), endDateExclusive: date(process.end), color: process.color, status: processIndex < 2 ? 'В работе' : 'Не начато', details: `Производственный цикл «${process.title.toLowerCase()}» для анимационного сериала. Совместная работа команды, промежуточные просмотры и согласование результата.`, sortIndex: processIndex, revision: 0 });
  assignments.push({ id: id(17, 100 + processIndex), projectId, targetType: 'process', targetId: processId, personId: id(16, processIndex % 2 + 1), roleLabel: processIndex % 2 === 0 ? 'Арт-директор' : 'Продюсер', isLead: true, sortIndex: processIndex });
  process.tasks.forEach(([title, start, end, row], position) => {
    const taskId = id(15, ++taskIndex);
    const personIndex = 3 + (processIndex + position) % 6;
    tasks.push({ id: taskId, processId, laneId: id(13, processIndex * 4 + row + 2), title, startDate: date(start), endDateExclusive: date(end), status: start < 60 ? 'В работе' : 'Не начато', details: `Работа над этапом «${title.toLowerCase()}». Подготовить материалы и передать на просмотр руководителю процесса.`, sortIndex: position, revision: 0 });
    assignments.push({ id: id(17, taskIndex), projectId, targetType: 'task', targetId: taskId, personId: id(16, personIndex), roleLabel: ['Художник', 'Художник', 'Аниматор', 'Режиссёр', 'Композитор', 'Монтажёр'][personIndex - 3], isLead: false, sortIndex: taskIndex + 8 });
  });
});

const stages = [
  { title: 'Подготовка', day: 0 }, { title: 'Препродакшн', day: 61 },
  { title: 'Продакшн', day: 153 }, { title: 'Постпродакшн', day: 273 }, { title: 'Премьера', day: 365 },
];

export const productionDemo = projectDocumentSchema.parse({
  schemaVersion: 1,
  project: { id: projectId, name: 'Сказки Амура', description: 'Анимационный сериал · три серии', anchorDate: origin, startDate: origin, endDateExclusive: date(365), sortIndex: 0, revision: 0, createdAt: timestamp, updatedAt: timestamp },
  stageMarkers: stages.map((stage, index) => ({ id: id(12, index + 1), projectId, title: stage.title, date: date(stage.day), sortIndex: index })),
  stageBands: stages.slice(0, 4).map((stage, index) => ({ id: id(18, index + 1), projectId, title: stage.title, leftBoundaryId: id(12, index + 1), rightBoundaryId: id(12, index + 2), sortIndex: index })),
  lanes, processes, tasks, assignments,
  people: [
    ['Александра Волкова', 'Арт-директор'], ['Михаил Орлов', 'Продюсер'], ['Анна Смирнова', 'Художник'], ['Иван Морозов', 'Художник'],
    ['Елена Ким', 'Аниматор'], ['Павел Соколов', 'Режиссёр'], ['Мария Лебедева', 'Композитор'], ['Денис Белов', 'Монтажёр'],
  ].map(([displayName, defaultRole], index) => ({ id: id(16, index + 1), displayName, defaultRole, createdAt: timestamp, updatedAt: timestamp })),
  viewPreferences: { projectId, gridStep: '1w', zoomPxPerDay: 14, cameraX: 24, cameraY: 0, showWeekends: true, expandedProcessIds: [id(14, 1), id(14, 2)], expandedAssigneeGroupIds: [], showPeoplePanel: true },
});
