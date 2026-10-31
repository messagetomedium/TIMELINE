import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { Snapshot, Result } from "../../domain/v2/model";
import type { TimelineCamera } from "../../domain/timeline";
import { xBefore } from "../../domain/SegmentAxis";
import { isResultPlaced, resultLayout } from "../../domain/v2/results";
import type { SendCommand } from "./StageControls";
import { CommitText } from "./CommitText";
export function ResultFields({
  snapshot,
  result,
  processId,
  stageId,
  onCommand,
}: {
  snapshot: Snapshot;
  result: Result | undefined;
  processId: Snapshot["processes"][number]["id"] | null;
  stageId: string;
  onCommand: SendCommand;
}) {
  const [newId] = useState(() => crypto.randomUUID());
  const id = result?.id ?? newId,
    placed = result ? isResultPlaced(snapshot, result) : false;
  return (
    <section className="result-fields">
      <h3>{processId ? "Результат процесса" : "Результат этапа"}</h3>
      <label>
        Название результата
        <CommitText
          key={`title:${result?.title ?? ""}`}
          label="Название результата"
          value={result?.title ?? ""}
          allowEmpty
          onCommit={(value) => {
            void onCommand({
              type: "UpdateResult",
              id,
              stageId,
              processId,
              field: "title",
              value,
            });
          }}
        />
      </label>
      <label>
        Описание результата
        <CommitText
          key={`description:${result?.description ?? ""}`}
          label="Описание результата"
          value={result?.description ?? ""}
          multiline
          onCommit={(value) => {
            void onCommand({
              type: "UpdateResult",
              id,
              stageId,
              processId,
              field: "description",
              value,
            });
          }}
        />
      </label>
      <button
        className="quiet-button"
        disabled={!result?.title.trim() || placed}
        onClick={() => {
          void onCommand({ type: "SetResultPlaced", id, placed: true });
        }}
      >
        Добавить результат на таймлайн
      </button>
      {placed && (
        <button
          className="quiet-button"
          onClick={() => {
            void onCommand({ type: "SetResultPlaced", id, placed: false });
          }}
        >
          Скрыть плашку результата
        </button>
      )}
      {!processId && result && (
        <button
          className="danger-button"
          onClick={() => {
            void onCommand({ type: "DeleteResult", id });
          }}
        >
          Удалить самостоятельный результат
        </button>
      )}
      <p className="inspector-note">
        Название и описание общие с панелью процесса. Скрытая плашка сохраняет
        данные. Положение меняется только по вертикали.
      </p>
    </section>
  );
}
export function ResultColumns({
  snapshot,
  camera,
  processY,
  onSelect,
  onCommand,
}: {
  snapshot: Snapshot;
  camera: TimelineCamera;
  processY: ReadonlyMap<string, number>;
  onSelect: (id: string) => void;
  onCommand: SendCommand;
}) {
  const tiles = resultLayout(snapshot, processY);
  return (
    <div className="result-columns">
      {(camera.gaps ?? []).map((g) => (
        <div
          className="result-column"
          data-result-column={g.stageId}
          key={g.stageId}
          style={{ left: xBefore(g.boundary, camera), width: g.width }}
        >
          <div className="result-column-tools" data-interactive>
            <button
              aria-label={`Добавить результат этапа: ${snapshot.stages.find((s) => s.id === g.stageId)?.title ?? ""}`}
              onClick={() => {
                const id = crypto.randomUUID();
                void onCommand({
                  type: "CreateStandaloneResult",
                  id,
                  stageId: g.stageId,
                  title: "Новый результат",
                }).then((ok) => {
                  if (ok) onSelect(id);
                });
              }}
            >
              + Результат этапа
            </button>
          </div>
          {tiles
            .filter((t) => t.result.stageId === g.stageId)
            .map((t) => (
              <ResultTile
                key={t.result.id}
                result={t.result}
                y={t.y}
                revision={snapshot.project.revision}
                onSelect={onSelect}
                onCommand={onCommand}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
function ResultTile({
  result,
  y,
  revision,
  onSelect,
  onCommand,
}: {
  result: Result;
  y: number;
  revision: number;
  onSelect: (id: string) => void;
  onCommand: SendCommand;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<{
      pointer: number;
      start: number;
      y: number;
      revision: number;
      next: number;
    } | null>(null),
    node = useRef<HTMLDivElement>(null);
  const cancel = () => {
    const d = drag.current;
    drag.current = null;
    setPreview(null);
    if (d && node.current?.hasPointerCapture(d.pointer))
      node.current.releasePointerCapture(d.pointer);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  const finish = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    cancel();
    if (d.revision === revision && d.next !== d.y)
      void onCommand(
        { type: "MoveResult", id: result.id, y: d.next },
        d.revision,
      );
  };
  return (
    <div
      ref={node}
      data-interactive
      data-result-id={result.id}
      data-layout-y={preview ?? y}
      className={`result-tile ${preview !== null ? "result-preview" : ""}`}
      style={{ top: preview ?? y }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d && e.pointerId === d.pointer) {
          d.next = Math.max(0, d.y + e.clientY - d.start);
          setPreview(d.next);
        }
      }}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      <button
        className="result-move"
        aria-label={`Переместить результат: ${result.title}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (
            document.activeElement instanceof HTMLInputElement ||
            document.activeElement instanceof HTMLTextAreaElement
          )
            document.activeElement.blur();
          e.preventDefault();
          e.stopPropagation();
          drag.current = {
            pointer: e.pointerId,
            start: e.clientY,
            y,
            revision,
            next: y,
          };
          node.current?.setPointerCapture(e.pointerId);
        }}
      >
        ⠿
      </button>
      <button
        className="result-select"
        aria-label={`Результат: ${result.title}`}
        onClick={() => {
          onSelect(result.id);
        }}
      >
        <strong>{result.title}</strong>
        <small>
          {result.processId
            ? "Результат процесса"
            : "Самостоятельный результат"}
        </small>
      </button>
    </div>
  );
}
