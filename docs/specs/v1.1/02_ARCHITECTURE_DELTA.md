# TIMELINE — архитектура: исправления после аудита V1

Этот документ дополняет актуальную архитектуру `docs/specs/02_ARCHITECTURE.md` в репозитории. Не заменять её новой системой и не менять стек Vite + React + TypeScript.

## A. Разделить три слоя, которые сейчас визуально смешаны

**1. Domain / Schedule** — данные, которые реально меняют производство:
`Project`, `StageMarker`, `StageBand`, `Process`, `Task`, `Lane`, `Person`, `Assignment`. Даты — date-only `YYYY-MM-DD`, интервалы `[start, endExclusive)`.

**2. Presentation / TimelineViewState** — способ рассматривать план, без изменения сроков:
`zoomPxPerDay`, `gridStep`, `centerDate/scrollOffset`, `showWeekends`, `expandedProcessIds`, `expandedAssigneeGroupIds`, `selectedEntity`, `activeGesture`, `showPerformers`, будущие `leftGutterWidth` и `inspectorWidth`. Сохранение ViewState позже не должно переписывать расписание.

**3. Operations / Commands** — операции редактирования расписания:
`rename`, `move`, `resize`, `moveStage`, затем `create`, `delete`, `setStatus`, `updateDates`, `assignPerson`, `changeLane`, `moveSelection`, `shiftProject`. Любой интерфейс, будущий сервер и будущий MCP вызывают одинаковые проверяемые команды, не изменяя напрямую массивы React state.

## B. Единая модель горизонтальной координаты

Сейчас в `src/domain/timeline.ts` уже есть основной контракт `xForDate` и `dateAtX`. Использовать его во всех рендерах и не дублировать математику в компонентах.

Рекомендуемые чистые функции:
- `dateToCanvasX(date, camera)` — X относительно ВРЕМЕННОГО viewport, без левого gutter.
- `canvasXToDate(x, camera)` — обратное преобразование.
- `getVisibleRange(camera, viewportWidth)` — видимые даты.
- `getCalendarCells(range, gridStep)` — массив интервалов `[start, endExclusive)` и меток, разбитых по месяцам/неделям/дням; это единый источник и для шапки, и для сетки.
- `cameraForFocusDate(date, viewportWidth, focusRatio, zoom)` — позиционирование даты в x=focusRatio*width.
- `cameraForFitRange(range, viewportWidth, paddings)` — отдельный fit, НЕ логика запуска.

Важно: когда применяется DOM-структура с левым фиксированным `gutterWidth`, `event.clientX` надо переводить в координаты временного viewport через boundingClientRect. Не добавлять gutter в одних компонентах и вычитать в других. Иначе drag/resize и сетка будут визуально расходиться.

Возможная композиция:

```text
EditorShell
  TopBar / ProjectNavigation
  WorkspaceColumns
    StickySectionLabels (fixed, не участвует в горизонтальном времени)
    TimeViewport (scroll and calendar coordinates)
      CalendarHeader (месяц + выбранный шаг)
      StageHeader (границы / подписи)
      MainTimeline (process/task lanes, общий X)
      PerformersTimeline (тот же X)
  DetailsInspector (fixed width, не входит в TimeViewport)
  BottomToolbar (zoom, step, weekends, today, fit)
```

Не обязательно делать буквально один огромный scrolling DOM: разные Y-контейнеры допускаются, но **каждый** получает идентичную camera, visible range и time origin. Stage/current-day marker/column boundaries должны строиться из общей календарной геометрии.

## C. Инициализация камеры

- При первом открытии предпочтительный масштаб `workZoom` (~14 px/day, точное значение подбирается визуально) вместо fit-year.
- Если локальная сегодняшняя дата находится в пределах проекта — фокус на сегодня примерно с коэффициентом 0.3–0.35 ширины временного окна.
- В противном случае фокус на старте первых актуальных процессов/проекта.
- После инициализации ResizeObserver меняет только `viewportWidth`, не сбрасывая camera.zoom/pan.
- Команды `GoToToday` и `FitProject` меняют только UI camera. При переходе к сохранённым пользовательским представлениям приоритет может получить сохранённый ViewState.

## D. Модель календарных ячеек

Тип календарной ячейки:

```ts
interface CalendarCell {
  start: DateOnly;
  endExclusive: DateOnly;
  label: string;
  secondaryLabel?: string;
  kind: 'day' | 'multi-day' | 'week' | 'month';
}
```

На границе видимого окна элементы могут быть частично обрезаны по X, но даты ячеек остаются настоящими. Для месячных границ используют отдельный набор маркеров, отличимый от сетки выбранного шага. Надписи скрывать/сокращать исходя из измеренной ширины ячейки, не вручную по фиксированному числу календарных дней.

Дни недели считаются из календарной даты, без локального `Date.parse` со сдвигами часового пояса; локальная дата «Сегодня» вычисляется отдельно и не сериализуется как stage.

## E. Границы этапов и модель редактирования

`StageMarker.date` остается единственным источником истины. Drag и ввод даты вызывают одну и ту же команду `moveStage` с проверкой порядка маркеров. `StageBand` ссылается на соседние маркеры через ID и отображает их актуальный интервал.

## F. Сохранить подготовку к будущему многопользовательскому режиму

Не подключать сервер сейчас. Но будущие изменяющие операции должны быть детерминированными и сериализуемыми. React preview не считается коммитом, один пользовательский drag — одна операция. В перспективе это позволит сделать undo/redo, IndexedDB, атомарные серверные операции и предварительное согласование предложенных ChatGPT правок.

## G. Технический долг V1, который нельзя выдавать за реализованное

- `PerformersSection` пока плоский список: будущая группировка по lead assignment и task assignments отдельно.
- `DetailsInspector` почти read-only: будущие формы редактирования должны вызывать commands, а не mutate модели напрямую.
- Пока `App` хранит документ только в памяти: IndexedDB/Dexie будет новым адаптером `ProjectRepository`.
- Отказ от серверной части не означает отказаться от тестов геометрии, сохранения ViewState позже и безопасного экспорта/импорта локальных файлов.

## H. На что не тратить время сейчас

Не вводить сложный realtime engine, CRDT, канвас-движок вместо существующей DOM/SVG сцены, Godot/Electron/Tauri, новый рендер с нуля, отдельный backend или систему ролей. Усложнение не решит проблему читаемости календаря.
