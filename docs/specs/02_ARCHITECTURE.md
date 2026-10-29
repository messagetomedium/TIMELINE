# TIMELINE — техническая архитектура v2 (visual-first)
Дата 29.10.2026. Репозиторий: `https://github.com/messagetomedium/TIMELINE`.

## 1. Архитектурная цель

Один источник истины — **календарный проект**. Несколько представлений (`Проект`, `Все проекты`, `Исполнители`, `PDF`) строятся из тех же данных и используют одну модель дат. Экран не должен хранить отдельные «истинные» даты в пикселях. Пиксель — лишь отображение календарного интервала.

**Главная ось реализации:** сначала предоставить осязаемый редактор (полосы, сетка, этапы, панорамирование, масштаб, выбор, перемещение, раскрытие), затем наращивать модели, сохранение и возможности.

## 2. Технологический стек и текущий код

В репозитории уже используется Vite + React 19 + TypeScript strict + Zod, Vitest, Playwright и GitHub Actions. **Стек не менять.** Существующие `src/domain/dates.ts`, `src/domain/schema.ts`, `src/domain/ids.ts`, календарные тесты и CI — полезная база. Рефакторить адресно, не переписывать без необходимости.

Для следующих итераций:
- UI и реактивное состояние: React + TypeScript; Zustand допустим, когда появится общее состояние редактора; не требовать его ради простого прототипа.
- Отрисовка: HTML элементы для интерактивных полос, подписей и форм; единый SVG слой для сетки/маркерных линий/контуров, либо Canvas для очень большого фона. **Не использовать библиотеку Gantt, диктующую чужую компоновку.** Pointer Events, `setPointerCapture` для drag/resize.
- Локальное сохранение: Dexie + IndexedDB после появления работающей сцены. Репозиторный интерфейс уже существует, его адаптировать. JSON-бэкап.
- Векторный PDF: отдельный export-адаптер на базе того же расчёта геометрии, с кириллическим шрифтом; подходящую библиотеку (pdf-lib, svg-to-pdf и т. п.) определить при реализации по тесту точности, а не по предпочтению.
- Будущая сеть: Supabase Auth + PostgreSQL + Realtime + проверяемая сервером обработка команд. Доступы и приглашения отдельно.
- Внешний ChatGPT: HTTP/MCP-сервер как адаптер к тем же серверным командам, с явным предварительным подтверждением правок.

НЕ внедрять сейчас Next.js, Tauri, Google OAuth, сервис на Node, Supabase, ChatGPT API. Это не поможет первой визуальной итерации.

## 3. Принципиальная структура UI

```text
ApplicationShell
  ├─ ProjectPicker / PortfolioSwitcher
  └─ TimelineWorkspace (занимает окно, без max-width контейнера)
      ├─ CalendarRuler (фиксирован вертикально)
      ├─ StageBand (название областей)
      ├─ StageBoundaryOverlay (маркеры сверху + вертикальные линии)
      ├─ TimeGrid (клетки, выходные, линия «сегодня»)
      ├─ TimelineBody
      │    ├─ ProcessLane[]
      │    │    └─ ProcessBar + expanded TaskLane[] / TaskBar[]
      │    └─ PerformersSection / PerformerLane[]
      ├─ InteractionOverlay (выделение/preview/подсказки)
      ├─ FloatingToolbar (undo/redo, +/- zoom, шаг, выходные, pdf)
      └─ DetailsInspector (справа, выборка элемента)
```

`CalendarRuler`, `StageBoundaryOverlay`, `TimeGrid`, `ProcessLane` и `PerformersSection` обязаны разделять **одну time-coordinate transform**. Никогда не рассчитывать дату->x в каждом компоненте независимо, даже если «почти совпадает».

Нижнюю секцию можно прокручивать по вертикали вместе с рабочей областью или закреплять под основной секцией как отдельный вертикальный pane; решение зависит от удобства. Горизонтальная временная координата и pan/zoom в обоих случаях единые.

## 4. Единая календарная система координат

Основные параметры (`CameraState`):
- `originDate: DateOnly` — опорная дата в календарном исчислении;
- `pxPerDay: number` — масштаб, например initial 20–28 px/день, ограничение минимум/максимум;
- `panX: number`, `panY: number` — сдвиги viewport, UI-only;
- `snapStep: '1d'|'2d'|'3d'|'1w'|'2w'|'1mo'` — привязка и клетки;
- `showWeekends: boolean`;
- `showPeople: boolean`;
- `expandedProcessIds`, `expandedPerformerGroups`, `selectedIds`, `hoveredId`.

Функции чистые:

```ts
xForDate(date: DateOnly, camera: CameraState): number;
dateAtX(x: number, camera: CameraState): DateOnly;
snapDate(date: DateOnly, step: SnapStep, mode: 'nearest'|'floor'|'ceil'): DateOnly;
widthForInterval(start: DateOnly, endExclusive: DateOnly, camera: CameraState): number;
getVisibleDateRange(viewportPx: number, camera: CameraState): DateRange;
```

- Учитывать полуоткрытые интервалы `[startDate, endDateExclusive)`, минимальная длительность 1 календарный день; UI показывает конечный день включительно.
- Не использовать `Date.parse('YYYY-MM-DD')` со скрытым часовым поясом как базу расчётов; существующий `dates.ts` уже содержит date-only утилиты. Сдвиги по календарным дням, не миллисекундам.
- Неделя начинается в понедельник. `1w` и `2w` имеют устойчивые якоря. `1mo` привязан к реальным первым числам месяцев. Для `2d`,`3d` выбрать и задокументировать устойчивый календарный якорь; не менять его при pan.
- Zoom сохраняет дату под курсором/центром viewport: изменяется `pxPerDay`, затем корректируется `panX` так, чтобы фокус не прыгал.
- Движение pan не меняет ни даты объектов, ни их laneId.
- Маркер «Сегодня» читает локальную календарную дату устройства; обновляется при смене суток и при возврате на вкладку. Это только визуальная вертикальная линия, не объект проекта.
- Stage boundary, process, task, performer assignment MUST use same `xForDate`.

## 5. Вертикальная компоновка (layout engine)

Нужен отдельный чистый `layoutTimeline(document, viewState) -> SceneLayout`, определяющий Y-позиции, высоты и порядки строк. Состав верхней секции: каждая верхнеуровневая `ProcessLane` хранит произвольно установленный пользователем порядок. На ней может располагаться несколько **непересекающихся по времени** процессов. Для каждого раскрытого процесса renderer вставляет под его полосой все `TaskLane` этого процесса (также с заданным пользователем порядком) и расширяет занимаемую высоту. Раскрытие одного процесса не заставляет автоматически закрывать другой, а сдвигает следующие по Y.

Объекты одной lane могут быть последовательно размещены справа друг от друга; пересекающиеся интервалы на одной lane недопустимы. Между разными lane допускается любой параллелизм. Никакого автоматического packing по высоте после каждого перемещения. При переносе между строками меняется `laneId`, при необходимости создаётся новая строка; показывать preview и подсказку коллизии.

**Возможный нюанс:** несколько процессов на одной lane, один раскрыт, другой нет. Раскрытые задачи занимают под ним вертикальную часть; новый процесс справа может располагаться в общей lane сверху. Раскладку раскрытых детей надо делать как вложенную секцию, не нарушающую координату по X у соседей. Минимальный вариант — вся `ProcessLane` увеличивает высоту до максимальной раскрытой группы в этой строке; для следующей строки Y сдвигается. Не допускать перекрытий детей соседних процессов, если интервалы их заголовков не пересекаются.

`SceneLayout` — тот же расчёт геометрии для экрана и PDF (различается только способ рисования), чтобы избежать несовпадения результата и превью.

## 6. Модель данных (логическая)

UUID для всех сущностей. Строгая валидация. Базовая структура:

```ts
type Project = {
  id: string; name: string; description?: string;
  startDate: DateOnly; endDateExclusive: DateOnly;
  sortOrder: number; revision: number;
};

type StageBoundary = { id: string; projectId: string; date: DateOnly; order: number };
type StageBand = {
  id: string; projectId: string; title: string;
  leftBoundaryId?: string; rightBoundaryId?: string;
  order: number;
};

type Lane = {
  id: string; projectId: string; parentProcessId?: string;
  kind: 'process' | 'task'; order: number;
};

type Process = {
  id: string; projectId: string; laneId: string;
  title: string; description?: string; result?: string;
  startDate: DateOnly; endDateExclusive: DateOnly;
  color: string; status: Status; revision: number;
};

type Task = {
  id: string; processId: string; laneId: string;
  title: string; description?: string; result?: string;
  startDate: DateOnly; endDateExclusive: DateOnly;
  status: Status; revision: number;
};

type Person = { id: string; name?: string; defaultRole?: string };
type Assignment = {
  id: string; projectId: string;
  targetType: 'process'|'task'; targetId: string;
  personId?: string; roleLabel: string; isLead: boolean;
};

type ViewState = {
  zoomPxPerDay: number; panX: number; panY: number;
  snapStep: SnapStep; showWeekends: boolean; showPeople: boolean;
  expandedProcessIds: string[]; expandedPerformerGroupIds: string[];
};
```

Псевдотипы — **семантический контракт**, не требуют слепо копировать. Текущие Zod schema в проекте близки к этой модели, но `StageMarker(title, date)` больше не выражает точно разделяемую границу этапов. Рекомендуется заменить в отдельной небольшой миграции на `StageBoundary` + `StageBand`; либо добавить `StageBand` поверх существующих markers с явным правилом смежных границ. Демо пока только в памяти, значит сохранённых пользовательских документов на сервере нет. Но код тестов и подготовленный data adapter сохранить где возможно.

`Person` глобальный между проектами; в локальном хранилище отдельная библиотека персон. `Assignment` позволяет роль без имени и несколько исполнителей для одной задачи. Внизу показывается роль+имя, если имя известно.

## 7. Команды и инварианты (business logic, не компоненты React)

UI не должен напрямую менять объекты данных/IndexedDB. Единая application-команда с изменениями данных атомарно:

```ts
CreateProject; DuplicateProject; RenameProject; DeleteProject;
AddStageBoundary; MoveStageBoundary; EditStageTitle;
AddProcess; RenameProcess; MoveProcess; ResizeProcess; ChangeProcessLane;
AddTask; RenameTask; MoveTask; ResizeTask; ChangeTaskLane;
GroupMove; AssignPerson; UpdateStatus; ChangeProcessColor;
ShiftProject; SetDetails; DeleteTask; DeleteProcess;
```

Обязательные свойства:
- `MoveProcess(deltaCalendarDays)` сдвигает сам процесс и **все вложенные задачи один раз**, не меняя этапы.
- `MoveTask(deltaCalendarDays, newLaneId?)` меняет только задачу; если она выходит за процесс, расширяется процесс; если нарушена коллизия на целевой дорожке, команда не применяется и показывает понятную ошибку.
- `ResizeTask(leftOrRight, snappedDate)` меняет границу с минимальной длиной 1 день. Процесс при необходимости расширяется. При сужении задачи процесс автоматически не сокращать: он может содержать запас времени.
- `ResizeProcess(leftOrRight, snappedDate)` не может отрезать существующие задачи; **не сдвигает детей**, если меняется только граница контейнера.
- `MoveStageBoundary` меняет только дату границы; связанные подписи/области обновляются. Не двигает процессы.
- `ShiftProject(deltaCalendarDays)` сдвигает границы проекта, все StageBoundary, Process и Task один раз; не переназначает людей.
- `GroupMove(selection, deltaDays, deltaLane?)` нормализует выбор: если выбран процесс и его ребёнок, ребёнок сдвигается только один раз. Проверяет все коллизии целиком, иначе отклоняет все изменения.
- `DuplicateProject` копирует вложенные сущности с новыми UUID, корректно переписывает ID-ссылки. Персоны из общего каталога не дублируются; назначения в копии указывают на те же персоны, но имеют новые ID.
- Текущая реализация `ProjectDocument` и `dates.ts` должна оставаться корректной: оптимизировать только там, где меняется семантика.

## 8. Редакторские взаимодействия

Рекомендуемая state machine одной жестовой сессии:

```text
idle
  ├─ selecting
  ├─ panning
  ├─ dragging-bar   (only explicit move handle)
  ├─ resizing-left  (edge handle)
  ├─ resizing-right (edge handle)
  ├─ dragging-stage (circular marker)
  └─ editing-label (double-click)
```

Pointerdown фиксирует исходные данные и координаты (не записывает command); pointermove рисует preview; pointerup формирует **одну** атомарную команду и, при успехе, одну запись undo; Escape/pointercancel откатывает предварительный вид. DOM фокус инпута не должен провоцировать drag и глобальное Ctrl+Z.

Разделить:
- `EditorSession` — временная state machine и hover/selection;
- `CommandBus` — validates/executes operation;
- `ProjectRepository` — чтение/сохранение;
- `TimelineRenderer` — отображение по `SceneLayout`.

Много одинаковых `pointermove` не должно создавать сотни сохранений и undo-шагов. Не хранить текущую x-позицию как бизнес-дату до подтверждения действия.

## 9. Локальные данные и переход к серверу

Первая версия: IndexedDB по рабочему экземпляру в браузере; атомарное сохранение после команд, миграция версий схемы, предупреждение об удалении данных при очистке браузера, JSON backup/import. При первом запуске создать **один полноценный редактируемый пример**, только если приложение никогда ранее не инициализировалось; не пересоздавать его после удаления последнего проекта. Пустой новый проект — отдельная явная команда.

Вторая версия: repository adapter на HTTP/Postgres, авторизация и проверка membership на сервере, права `admin` / `guest`, гостевая ссылка через expiring/revocable invitation. Для совместного редактирования — серверная атомарность с `revision`, события только после commit, оптимистическая локальная отрисовка и повторная загрузка на конфликте. Временная блокировка объекта — lease с TTL/renewal, установленный сервером, а не только блокировка в интерфейсе. Учитывать последствия перемещения родительского процесса: блокировка/транзакция должна охватить затронутых детей. Не брать публичный anon-доступ как эквивалент прав.

## 10. ChatGPT, будущая интеграция

Нужны серверные операции «прочитать проекты», «прочитать таймлайн», «сформировать план изменений», «показать diff», «подтвердить и применить», «назначить исполнителя», «изменить даты/статусы». MCP-сервер предоставляет безопасные инструменты к уже существующему command API; пользователь подписывает намерение, права проверяются на сервере, состав изменений журналируется. **Никогда не передавать ChatGPT прямой unrestricted доступ к SQL/секретам базы.** Использование через обычный ChatGPT зависит от поддерживаемых возможностей и разрешений подключаемых приложений в соответствующей рабочей среде; тестировать при внедрении.

MCP подключать только после стабилизации базы, permissions и команд. Первая локальная версия независима от OpenAI.

## 11. Экспорт PDF по той же сцене

`exportView = deriveExportScene(project, viewState, viewport)`; скрыть редакторские контролы. Область времени должна соответствовать тому, **что пользователь видит на рабочей области в момент экспорта**, включая масштаб, pan, раскрытия и нижнюю секцию. В экспорте оставить grid/маркеры/цвет/названия, исключить inspector/header/toolbar.

Нельзя называть PDF-экспортом простое печатание `ProjectSummary` и нельзя принудительно раскрывать все процессы. Способы реализации: отдельный SVG snapshot из `SceneLayout` (с векторными прямоугольниками, линиями и текстом), печать SVG в одну страницу либо SVG→PDF с поддержкой кириллицы. Любое решение должно пройти визуальное сравнение экспортного изображения с viewport и тест на длинный горизонтальный план.

## 12. Пределы и тестирование

На первом реалистичном образце: 4 этапа, минимум 8 процессов, минимум 25 задач, 4+ параллельных строк, несколько десятков интервалов назначений, длинный период (не меньше года). Проверить панорамирование, zoom, snap, развертывание 3 процессов сразу, перенос строки и совпадение верхней/нижней оси. Пример должен быть оформлен как производственный таймлайн, близкий по плотности к PDF, а не «Осенняя премьера» с двумя процессами в текстовом списке.

Unit tests: date coordinate math, snapping incl. leap years/month, transformations, parent/child constraints, collisions, group move, clone. Playwright: actual pointer gestures, panel opening, double-click edit, pan, zoom, multiple expansions, performer highlight, persistence after reload, PDF export. Browser screenshot при масштабе 1440×900 и 1920×1080 — обязательная визуальная проверка, без горизонтально обрезанного инспектора и текста, выползающего из плашек.

## 13. Не переписывать код бесцельно

1. Использовать существующий Vite build, CI, test tooling, `dates.ts` и доменные тесты.
2. Перенести `ProjectOverview` в переключатель проектов; `ProjectSummary` больше не должен быть основным экраном проекта.
3. Убрать ограничение ширины контента в редакторе, но сохранить обычный responsive layout списка проектов.
4. Пример из `src/infrastructure/demo/project.ts` заменить/дополнить полноценным производственным сценарием, но не использовать его как единственный источник реальных данных.
5. После каждого шага подтверждать `npm run lint`, `npm run build`, `npm run test`, `npm run test:e2e` и визуально проверять скриншот рабочего редактора.
