import { useRef, useState } from "react";
import { activeAssignment, fullName } from "../../domain/v2/peopleModel";
import type {
  CatalogState,
  Person,
  PersonFields,
} from "../../domain/v2/peopleModel";
import type { PeopleCommand } from "../../domain/v2/people";
import type { Snapshot } from "../../domain/v2/model";
import type { SendCommand } from "./StageControls";
import { CommitText } from "./CommitText";
export type SendPeople = (command: PeopleCommand) => Promise<boolean>;
export interface AssignmentTarget {
  kind: "process" | "task";
  targetId: string;
}
const blank: PersonFields = {
  firstName: "",
  lastName: "",
  defaultRole: "",
  contacts: "",
  note: "",
};
const fieldLabels = {
  firstName: "Имя",
  lastName: "Фамилия",
  defaultRole: "Основная роль",
  contacts: "Контакты",
  note: "Примечание",
};
export function PersonEditor({
  person,
  onSave,
  onFork,
  onClose,
}: {
  person?: Person | undefined;
  onSave: (fields: PersonFields) => Promise<boolean>;
  onFork?: ((fields: PersonFields) => Promise<boolean>) | undefined;
  onClose: () => void;
}) {
  const initial: PersonFields = person
    ? (Object.fromEntries(
        Object.keys(blank).map((k) => [k, person[k as keyof PersonFields]]),
      ) as PersonFields)
    : blank;
  const [fields, setFields] = useState(initial),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sending = useRef(false),
    last = useRef(JSON.stringify(initial));
  const perform = async (fork = false) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      if (await (fork && onFork ? onFork(fields) : onSave(fields))) {
        last.current = JSON.stringify(fields);
        setConfirm(false);
        onClose();
      } else
        setError(
          "Не удалось сохранить карточку. Проверьте сообщение об ошибке и повторите.",
        );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const submit = () => {
    if (!fields.firstName.trim() && !fields.lastName.trim()) {
      setError("Заполните имя или фамилию");
      return;
    }
    if (person && JSON.stringify(fields) === last.current) {
      onClose();
      return;
    }
    if (
      person &&
      (person.firstName !== fields.firstName.trim() ||
        person.lastName !== fields.lastName.trim())
    )
      setConfirm(true);
    else void perform();
  };
  return (
    <section className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={person ? "Карточка исполнителя" : "Новый исполнитель"}
        className="workspace-dialog person-editor"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <h2>{person ? "Карточка исполнителя" : "Новый исполнитель"}</h2>
        <p className="inspector-note">
          Общая карточка рабочего пространства. Человек может не иметь аккаунта.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onBlur={(e) => {
            const key = e.target.getAttribute("data-person-field") as
              | keyof PersonFields
              | null;
            if (
              person &&
              !busy &&
              !confirm &&
              key &&
              fields[key] !== initial[key] &&
              !(
                e.relatedTarget instanceof Element &&
                e.relatedTarget.closest("[data-cancel-person]")
              )
            )
              submit();
          }}
        >
          {(Object.keys(blank) as (keyof PersonFields)[]).map((key) => (
            <label key={key}>
              {fieldLabels[key]}
              {key === "note" ? (
                <textarea
                  data-person-field={key}
                  aria-label={fieldLabels[key]}
                  value={fields[key]}
                  disabled={busy}
                  onChange={(e) => {
                    setFields((old) => ({ ...old, [key]: e.target.value }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              ) : (
                <input
                  autoFocus={key === "firstName"}
                  data-person-field={key}
                  aria-label={fieldLabels[key]}
                  value={fields[key]}
                  disabled={busy}
                  onChange={(e) => {
                    setFields((old) => ({ ...old, [key]: e.target.value }));
                    setError("");
                  }}
                />
              )}
            </label>
          ))}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {!confirm && (
            <footer>
              <button
                type="button"
                className="quiet-button"
                disabled={busy}
                data-cancel-person
                onClick={onClose}
              >
                Отмена
              </button>
              <button className="primary-button" disabled={busy}>
                Сохранить карточку
              </button>
            </footer>
          )}
        </form>
        {confirm && (
          <section
            className="person-confirm"
            role="alertdialog"
            aria-label="Изменение общего имени"
          >
            <p>
              Имя и фамилия используются во всех проектах. Как сохранить
              изменение?
            </p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => {
                void perform();
              }}
            >
              Изменить общую карточку
            </button>
            {onFork && (
              <button
                className="quiet-button"
                disabled={busy}
                onClick={() => {
                  void perform(true);
                }}
              >
                Создать нового исполнителя для этого назначения
              </button>
            )}
            <button
              className="quiet-button"
              disabled={busy}
              onClick={() => {
                setConfirm(false);
              }}
            >
              Вернуться к редактированию
            </button>
          </section>
        )}
      </section>
    </section>
  );
}
export function PeopleCatalog({
  catalog,
  onCommand,
  onUndo,
  onClose,
}: {
  catalog: CatalogState;
  onCommand: SendPeople;
  onUndo: (redo?: boolean) => void;
  onClose: () => void;
}) {
  const [archived, setArchived] = useState(false),
    [editing, setEditing] = useState<Person | "new" | null>(null),
    [archiving, setArchiving] = useState<Person | null>(null);
  return (
    <>
      <section className="modal-backdrop">
        <section
          className="workspace-dialog people-catalog"
          role="dialog"
          aria-modal="true"
          aria-label="Исполнители пространства"
        >
          <header>
            <h2>Исполнители пространства</h2>
            <button className="quiet-button" onClick={onClose}>
              Закрыть
            </button>
          </header>
          <p className="inspector-note">
            Изменения общие для всех проектов. История справочника отдельная от
            истории проекта.
          </p>
          <div className="people-toolbar">
            <button
              className="primary-button"
              onClick={() => {
                setEditing("new");
              }}
            >
              Добавить исполнителя
            </button>
            <button
              aria-label="Отменить в справочнике"
              disabled={!catalog.undo.length}
              onClick={() => {
                onUndo();
              }}
            >
              ↶
            </button>
            <button
              aria-label="Повторить в справочнике"
              disabled={!catalog.redo.length}
              onClick={() => {
                onUndo(true);
              }}
            >
              ↷
            </button>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked);
              }}
            />
            Показать архивных
          </label>
          <ul className="people-list">
            {catalog.people
              .filter((p) => archived || !p.archivedAt)
              .map((p) => (
                <li key={p.id} data-catalog-person={p.id}>
                  <div>
                    <strong>{fullName(p)}</strong>
                    <span>
                      {p.defaultRole}
                      {p.archivedAt ? " · в архиве" : ""}
                    </span>
                    <small>{p.contacts}</small>
                  </div>
                  {p.archivedAt ? (
                    <button
                      className="quiet-button"
                      onClick={() => {
                        void onCommand({ type: "RestorePerson", id: p.id });
                      }}
                    >
                      Восстановить
                    </button>
                  ) : (
                    <>
                      <button
                        className="quiet-button"
                        onClick={() => {
                          setEditing(p);
                        }}
                      >
                        Изменить
                      </button>
                      <button
                        className="danger-button"
                        onClick={() => {
                          setArchiving(p);
                        }}
                      >
                        В архив
                      </button>
                    </>
                  )}
                </li>
              ))}
          </ul>
          {!catalog.people.length && (
            <p>
              Пока нет исполнителей. Добавьте карточку здесь или в назначении
              работы.
            </p>
          )}
        </section>
      </section>
      {editing && (
        <PersonEditor
          key={editing === "new" ? "new" : editing.id}
          person={editing === "new" ? undefined : editing}
          onClose={() => {
            setEditing(null);
          }}
          onSave={(fields) =>
            onCommand(
              editing === "new"
                ? { type: "CreatePerson", id: crypto.randomUUID(), fields }
                : { type: "UpdatePerson", id: editing.id, fields },
            )
          }
        />
      )}
      {archiving && (
        <section className="modal-backdrop">
          <section
            className="workspace-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label="Архивирование исполнителя"
          >
            <h2>Архивировать {fullName(archiving)}?</h2>
            <p>
              Активные назначения во всех проектах освободятся. В работах
              сохранятся служебные записи с прежним именем. Восстановление
              карточки само не возвращает назначения.
            </p>
            <button
              className="quiet-button"
              onClick={() => {
                setArchiving(null);
              }}
            >
              Отмена
            </button>
            <button
              className="danger-button"
              onClick={() => {
                void onCommand({
                  type: "ArchivePerson",
                  id: archiving.id,
                }).then((ok) => {
                  if (ok) setArchiving(null);
                });
              }}
            >
              Архивировать
            </button>
          </section>
        </section>
      )}
    </>
  );
}
export function AssignmentControl({
  snapshot,
  catalog,
  target,
  onCommand,
  onPeople,
}: {
  snapshot: Snapshot;
  catalog: CatalogState;
  target: AssignmentTarget;
  onCommand: SendCommand;
  onPeople: SendPeople;
}) {
  const raw = snapshot.assignments.find(
      (a) => a.kind === target.kind && a.targetId === target.targetId,
    ),
    assignment = raw ? activeAssignment(raw, catalog) : undefined,
    person = catalog.people.find((p) => p.id === assignment?.personId);
  const [optionIndex, setOptionIndex] = useState(-1);
  const [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false),
    [editing, setEditing] = useState<Person | "new" | null>(null);
  const choose = (
    personId: string | null,
    roleLabel = assignment?.roleLabel ?? "",
  ) =>
    onCommand({
      type: "SetAssignment",
      ...target,
      id: crypto.randomUUID(),
      personId,
      roleLabel,
    });
  const create = (fields: PersonFields) =>
    onCommand({
      type: "CreatePersonAndAssign",
      ...target,
      id: crypto.randomUUID(),
      personId: crypto.randomUUID(),
      roleLabel: assignment?.roleLabel || fields.defaultRole,
      fields,
    });
  const old = catalog.retiredAssignments.filter(
    (a) =>
      a.projectId === snapshot.project.id &&
      a.kind === target.kind &&
      a.targetId === target.targetId,
  );
  const matches = catalog.people.filter(
    (p) =>
      !p.archivedAt &&
      `${fullName(p)} ${p.defaultRole}`
        .toLocaleLowerCase("ru")
        .includes(query.toLocaleLowerCase("ru")),
  );
  return (
    <section className="assignment-control">
      <h3>
        {target.kind === "process"
          ? "Руководитель процесса"
          : "Исполнитель задачи"}
      </h3>
      {person && (
        <div className="assigned-person">
          <strong>{fullName(person)}</strong>
          <button
            className="quiet-button"
            onClick={() => {
              setEditing(person);
            }}
          >
            Карточка
          </button>
        </div>
      )}
      <label className="inspector-label">
        Поиск исполнителя
        <input
          role="combobox"
          aria-label="Поиск исполнителя"
          aria-autocomplete="list"
          aria-expanded={searching}
          aria-controls={`people-options-${target.targetId}`}
          aria-activedescendant={
            searching && matches[optionIndex]
              ? `person-option-${target.targetId}-${matches[optionIndex].id}`
              : undefined
          }
          placeholder={
            person ? "Заменить исполнителя" : "Имя, фамилия или роль"
          }
          value={query}
          onFocus={() => {
            setSearching(true);
          }}
          onBlur={() => {
            setSearching(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setSearching(false);
              setQuery("");
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSearching(true);
              setOptionIndex((old) =>
                matches.length
                  ? (old + (e.key === "ArrowDown" ? 1 : -1) + matches.length) %
                    matches.length
                  : -1,
              );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const first = matches[Math.max(0, optionIndex)];
              if (first) {
                void choose(
                  first.id,
                  assignment?.roleLabel || first.defaultRole,
                );
                setQuery("");
                setSearching(false);
              }
            }
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOptionIndex(-1);
            setSearching(true);
          }}
        />
      </label>
      {searching && (
        <ul
          className="people-options"
          role="listbox"
          id={`people-options-${target.targetId}`}
        >
          {matches.map((p) => (
            <li key={p.id}>
              <button
                role="option"
                id={`person-option-${target.targetId}-${p.id}`}
                aria-selected={person?.id === p.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={() => {
                  void choose(p.id, assignment?.roleLabel || p.defaultRole);
                  setQuery("");
                  setSearching(false);
                }}
              >
                {fullName(p)}
                {p.defaultRole ? ` · ${p.defaultRole}` : ""}
              </button>
            </li>
          ))}
          {!matches.length && <li>Совпадений нет</li>}
        </ul>
      )}
      <label className="inspector-label" htmlFor="assignment-role">
        Роль в работе
      </label>
      <CommitText
        key={`${assignment?.id ?? "none"}:${assignment?.roleLabel ?? ""}`}
        id="assignment-role"
        input
        allowEmpty
        value={assignment?.roleLabel ?? ""}
        onCommit={(value) => {
          void choose(person?.id ?? null, value);
        }}
      />
      <div className="stage-actions">
        <button
          className="quiet-button"
          onClick={() => {
            setEditing("new");
          }}
        >
          Создать исполнителя
        </button>
        {assignment && (
          <button
            className="quiet-button"
            onClick={() => {
              void choose(null, "");
            }}
          >
            Снять назначение
          </button>
        )}
      </div>
      {old.length > 0 && (
        <details className="assignment-records">
          <summary>Прежние назначения · {old.length}</summary>
          {old.map((r) => (
            <p key={r.assignmentId}>
              {r.nameSnapshot}
              {r.roleLabel ? ` · ${r.roleLabel}` : ""}
              <br />
              <small>
                Освобождено при архивировании{" "}
                {new Date(r.changedAt).toLocaleString("ru-RU", {
                  timeZone: "Europe/Moscow",
                })}
              </small>
            </p>
          ))}
        </details>
      )}
      {editing && (
        <PersonEditor
          person={editing === "new" ? undefined : editing}
          onClose={() => {
            setEditing(null);
          }}
          onSave={(fields) =>
            editing === "new"
              ? create(fields)
              : onPeople({ type: "UpdatePerson", id: editing.id, fields })
          }
          onFork={editing === "new" ? undefined : create}
        />
      )}
    </section>
  );
}
