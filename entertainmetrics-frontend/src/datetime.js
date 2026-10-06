function pad(value) {
  return String(value).padStart(2, "0");
}

// Value for <input type="datetime-local"> in the browser's local time.
export function localInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

// "2026-12-17T19:30" -> "2026-12-17T19:30:00+03:00", keeping the local date
// so the API validates against the venue's calendar day.
export function withLocalOffset(localValue) {
  const offsetMinutes = -new Date(localValue).getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return `${localValue}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// The current time as an ISO string with the browser's UTC offset.
export function nowWithOffset() {
  return withLocalOffset(localInputValue(new Date()));
}
