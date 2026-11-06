/** Shared author-inspired folder silhouette; the responsive surface owns its size. */
export function FolderShape() {
  return <svg className="pl-folder-shape" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
    <path d="M1 28Q1 1 28 1H92C120 1 126 25 155 25H372Q399 25 399 52V272Q399 299 372 299H28Q1 299 1 272Z" vectorEffect="non-scaling-stroke" />
  </svg>;
}
