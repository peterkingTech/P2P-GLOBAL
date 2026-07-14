export const MIN_SIGNUP_AGE = 16;

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function toISODate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function ageFromISODate(isoDate: string, today: Date = new Date()): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  let age = today.getUTCFullYear() - y;
  const hadBirthdayThisYear =
    today.getUTCMonth() + 1 > m || (today.getUTCMonth() + 1 === m && today.getUTCDate() >= d);
  if (!hadBirthdayThisYear) age--;
  return age;
}
