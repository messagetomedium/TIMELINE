import { useRef, useState } from "react";
/** Mount by entity+field value. A single commit path handles Enter, blur and selection changes. */
export function CommitText({
  value,
  onCommit,
  onFinish,
  id,
  label,
  multiline = false,
  autoFocus = false,
  input = false,
  allowEmpty = false,
}: {
  value: string;
  onCommit: (value: string) => void;
  onFinish?: () => void;
  id?: string;
  label?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  input?: boolean;
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(value),
    sent = useRef(value),
    cancelled = useRef(false);
  const commit = () => {
    const next = multiline ? draft : draft.trim();
    if (
      !cancelled.current &&
      next !== sent.current &&
      (multiline || allowEmpty || next)
    ) {
      sent.current = next;
      onCommit(next);
    }
    onFinish?.();
  };
  const props = {
    id,
    "aria-label": label,
    autoFocus,
    value: draft,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      cancelled.current = false;
      setDraft(e.target.value);
    },
    onBlur: commit,
    onKeyDown: (
      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelled.current = true;
        setDraft(value);
        e.currentTarget.blur();
      }
      if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        commit();
        e.currentTarget.blur();
      }
    },
  };
  return input ? (
    <input {...props} />
  ) : (
    <textarea {...props} rows={multiline ? 4 : 2} />
  );
}
