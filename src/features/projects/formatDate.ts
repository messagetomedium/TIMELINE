import type { DateOnly } from '../../domain';

const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const;

export function formatDate(value: DateOnly): string {
  const month = months[Number(value.slice(5, 7)) - 1];
  if (!month) throw new RangeError('Invalid calendar month');
  return `${String(Number(value.slice(8, 10)))} ${month} ${value.slice(0, 4)}`;
}
