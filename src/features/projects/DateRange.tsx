import { addDays } from '../../domain';
import type { DateInterval } from '../../domain';
import { formatDate } from './formatDate';

/** Inclusive final day is presentation only; stored intervals stay half-open. */
export function DateRange({ value }: { readonly value: DateInterval }) {
  const lastDay = addDays(value.endDateExclusive, -1);
  return <span className="date-range"><time dateTime={value.startDate}>{formatDate(value.startDate)}</time> — <time dateTime={lastDay}>{formatDate(lastDay)}</time></span>;
}
