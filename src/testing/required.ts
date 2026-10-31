/** Fail a test at its missing prerequisite instead of erasing nullability. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required test fixture or result is missing");
  return value;
}
