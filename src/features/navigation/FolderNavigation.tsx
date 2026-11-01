import { useEffect, useRef } from "react";
import type { ProjectSummary } from "../../application/v2/portfolio";
/** One route and one source of projects, shared by home and the editor. */
export function FolderNavigation({
  documents,
  activeId,
  home,
  onHome,
  onOpen,
}: {
  documents: readonly ProjectSummary[];
  activeId: string | null;
  home: boolean;
  onHome: () => void;
  onOpen: (id: string) => void;
}) {
  const tabs = useRef<HTMLDivElement>(null);
  const visible = documents.filter((d) => !d.project.archivedAt);
  const key = visible
    .map(
      (d) =>
        `${d.project.id}:${d.project.name}:${String(d.project.isScheduled)}`,
    )
    .join("\0");
  useEffect(() => {
    const node = tabs.current,
      active = node?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!node || !active) return;
    const reveal = () => {
      node.scrollLeft = active.offsetLeft;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [activeId, key]);
  return (
    <nav
      className="folder-navigation"
      aria-label="Проекты рабочего пространства"
    >
      <button
        className={`home-button ${home ? "active" : ""}`}
        aria-label="Домой"
        title="Главный экран рабочего пространства"
        aria-current={home ? "page" : undefined}
        onClick={onHome}
      >
        <svg
          viewBox="0 0 24 24"
          width="19"
          height="19"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m3 10 9-7 9 7M5 9v11h5v-7h4v7h5V9" />
        </svg>
      </button>
      <div className="folder-tabs" ref={tabs} data-testid="folder-tabs">
        {visible.map((d) => (
          <button
            className={`folder-tab ${activeId === d.project.id ? "active header-project" : ""}`}
            key={d.project.id}
            data-project-tab={d.project.id}
            aria-current={activeId === d.project.id ? "page" : undefined}
            aria-label={`Открыть проект: ${d.project.name}`}
            title={`${d.project.name}${d.project.isScheduled ? "" : " · Не размещён на общем таймлайне"}`}
            onClick={() => {
              onOpen(d.project.id);
            }}
          >
            <span>{d.project.name}</span>
            {!d.project.isScheduled && <small>Черновик</small>}
          </button>
        ))}
      </div>
    </nav>
  );
}
