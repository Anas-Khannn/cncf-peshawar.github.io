/**
 * CNCF Peshawar - Event Lifecycle Derivation
 *
 * Single source of truth for "has this event already happened?".
 *
 * Editorial `status` frontmatter remains the declared intent of the organizers,
 * but it is only advisory at render time. A stored `upcoming` status on an event
 * whose local end time has already elapsed is treated as stale metadata: the
 * rendered lifecycle state is always derived from the event schedule so an
 * expired event can never be promoted as the next meetup with live RSVP calls
 * to action.
 *
 * All schedule math is performed in `Asia/Karachi` (PKT) because event frontmatter
 * stores a bare local calendar date plus a local wall-clock time range.
 *
 * Written as plain ESM so the Astro build (Vite) and the Node-based E2E suites
 * consume the exact same implementation.
 */

/** @typedef {'upcoming' | 'completed' | 'canceled'} EventLifecycleStatus */

/**
 * @typedef {object} EventData
 * @property {string} [date]
 * @property {string} [time]
 * @property {string} [status]
 * @property {string[]} [tags]
 */

/**
 * @typedef {object} EventSchedule
 * @property {Date} startsAt Absolute instant the event begins.
 * @property {Date} endsAt Absolute instant the event is considered concluded.
 * @property {'zoned' | 'absolute'} source Whether the schedule came from local PKT fields or an absolute timestamp.
 */

/** IANA zone all community event times are authored in. */
export const EVENT_TIMEZONE = 'Asia/Karachi';

/** Rendered lifecycle states. */
export const UPCOMING = 'upcoming';
export const COMPLETED = 'completed';
export const CANCELED = 'canceled';

/** Grace period applied when only a start time is known (matches the OCG sync default session length). */
export const DEFAULT_EVENT_DURATION_MINUTES = 240;

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60 * 1000;

/**
 * Normalizes either a collection entry or a bare frontmatter object.
 * @param {unknown} event
 * @returns {EventData}
 */
function toEventData(event) {
  if (!event || typeof event !== 'object') return {};
  const candidate = /** @type {{ data?: EventData }} */ (event);
  if (candidate.data && typeof candidate.data === 'object') return candidate.data;
  return /** @type {EventData} */ (candidate);
}

/**
 * Parses a `YYYY-MM-DD` calendar date. A trailing time component is tolerated and
 * ignored so an absolute timestamp still renders as its authored calendar day.
 * @param {string | undefined | null} rawDate
 * @returns {{ year: number, month: number, day: number } | null}
 */
export function parseCalendarDate(rawDate) {
  if (typeof rawDate !== 'string') return null;
  const match = rawDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ][\d:.,+\-Z]*)?$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Reject impossible calendar days (e.g. 2026-02-30) by round-tripping through UTC.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }

  return { year, month, day };
}

/**
 * Converts a 12-hour clock reading into minutes past local midnight.
 * @param {number} hour
 * @param {string} meridiem Either `AM` or `PM`.
 * @returns {number}
 */
function twelveHourToMinutes(hour, meridiem) {
  const normalizedHour = hour % 12;
  return meridiem === 'AM' ? normalizedHour * 60 : (normalizedHour + 12) * 60;
}

/**
 * Extracts the start (and optional end) wall-clock time from an event `time` range.
 *
 * Accepts the formats the CMS and the OCG sync produce, e.g. `03:00 PM - 07:00 PM PKT`,
 * `3:00 PM – 7:00 PM`, `19:00`, or a single `07:00 PM`.
 *
 * @param {string | undefined | null} rawTime
 * @returns {{ startMinutes: number, endMinutes: number | null } | null}
 */
export function parseEventTimeRange(rawTime) {
  if (typeof rawTime !== 'string') return null;

  const normalized = rawTime.replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  /** @type {number[]} */
  const readings = [];

  const twelveHour = /(\d{1,2}):(\d{2})\s*(AM|PM)/gi;
  let match;
  while ((match = twelveHour.exec(normalized)) !== null) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    // An impossible reading (e.g. "99:99 PM") must not be coerced into a plausible time.
    if (hour < 1 || hour > 12 || minute > 59) continue;
    readings.push(twelveHourToMinutes(hour, match[3].toUpperCase()));
  }

  if (readings.length === 0) {
    const twentyFourHour = /(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/g;
    while ((match = twentyFourHour.exec(normalized)) !== null) {
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour > 23 || minute > 59) continue;
      readings.push(hour * 60 + minute);
    }
  }

  if (readings.length === 0) return null;

  return {
    startMinutes: readings[0],
    endMinutes: readings.length > 1 ? readings[readings.length - 1] : null
  };
}

/**
 * Offset of `timeZone` from UTC, in milliseconds, at the given instant.
 * @param {number} instantMs
 * @param {string} timeZone
 * @returns {number}
 */
function getTimeZoneOffsetMs(instantMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(instantMs));

  /** @type {Record<string, string>} */
  const fields = {};
  for (const part of parts) {
    if (part.type !== 'literal') fields[part.type] = part.value;
  }

  // Some engines render midnight as hour 24 even with hour12 disabled.
  const hour = Number(fields.hour) % 24;
  const asUtc = Date.UTC(
    Number(fields.year),
    Number(fields.month) - 1,
    Number(fields.day),
    hour,
    Number(fields.minute),
    Number(fields.second)
  );

  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Converts a wall-clock reading in `timeZone` into an absolute instant.
 * @param {{ year: number, month: number, day: number, hour?: number, minute?: number, second?: number, millisecond?: number }} parts
 * @param {string} [timeZone]
 * @returns {Date | null}
 */
export function zonedTimeToInstant(parts, timeZone = EVENT_TIMEZONE) {
  const { year, month, day } = parts;
  const hour = parts.hour ?? 0;
  const minute = parts.minute ?? 0;
  const second = parts.second ?? 0;
  const millisecond = parts.millisecond ?? 0;

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  if (Number.isNaN(wallClockAsUtc)) return null;

  // Two refinement passes converge even across DST transitions.
  let instantMs = wallClockAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    instantMs = wallClockAsUtc - getTimeZoneOffsetMs(instantMs, timeZone);
  }

  const instant = new Date(instantMs);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Builds the absolute schedule for an event from its local PKT calendar date and time range.
 *
 * Fail-safe rules:
 * - An unparseable or missing date yields `null` so callers fall back to stored status.
 * - A missing or unparseable time range covers the entire local calendar day, which can
 *   never promote a past date back into an upcoming state.
 *
 * @param {EventData | { data?: EventData } | undefined | null} event
 * @param {string} [timeZone]
 * @returns {EventSchedule | null}
 */
export function getEventSchedule(event, timeZone = EVENT_TIMEZONE) {
  const data = toEventData(event);
  const rawDate = typeof data.date === 'string' ? data.date.trim() : '';
  if (!rawDate) return null;

  // An absolute timestamp in `date` is already unambiguous; honour it directly.
  if (/\d{1,2}:\d{2}/.test(rawDate)) {
    const absoluteStart = new Date(rawDate);
    if (!Number.isNaN(absoluteStart.getTime())) {
      return {
        startsAt: absoluteStart,
        endsAt: new Date(absoluteStart.getTime() + DEFAULT_EVENT_DURATION_MINUTES * MS_PER_MINUTE),
        source: 'absolute'
      };
    }
  }

  const calendarDate = parseCalendarDate(rawDate);
  if (!calendarDate) return null;

  const range = parseEventTimeRange(data.time);
  const startsAt = zonedTimeToInstant(
    {
      ...calendarDate,
      hour: range ? Math.floor(range.startMinutes / 60) : 0,
      minute: range ? range.startMinutes % 60 : 0
    },
    timeZone
  );
  if (!startsAt) return null;

  if (!range) {
    const endsAt = zonedTimeToInstant({ ...calendarDate, hour: 23, minute: 59, second: 59, millisecond: 999 }, timeZone);
    return { startsAt, endsAt: endsAt ?? new Date(startsAt.getTime() + MINUTES_PER_DAY * MS_PER_MINUTE), source: 'zoned' };
  }

  let durationMinutes = DEFAULT_EVENT_DURATION_MINUTES;
  if (range.endMinutes !== null) {
    const span = (range.endMinutes - range.startMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    durationMinutes = span === 0 ? DEFAULT_EVENT_DURATION_MINUTES : span;
  }

  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + durationMinutes * MS_PER_MINUTE),
    source: 'zoned'
  };
}

/**
 * Detects explicit cancellation from either the status field or the `Canceled` tag
 * applied by the OCG sync for cancelled events.
 * @param {EventData | { data?: EventData } | undefined | null} event
 * @returns {boolean}
 */
export function isEventCanceled(event) {
  const data = toEventData(event);

  const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
  if (status === CANCELED || status === 'cancelled') return true;

  const tags = Array.isArray(data.tags) ? data.tags : [];
  return tags.some((tag) => {
    if (typeof tag !== 'string') return false;
    const normalized = tag.trim().toLowerCase();
    return normalized === 'canceled' || normalized === 'cancelled';
  });
}

/**
 * Normalizes a stored status value into a supported lifecycle state.
 * @param {string | undefined | null} status
 * @returns {EventLifecycleStatus}
 */
function normalizeStoredStatus(status) {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (value === 'cancelled') return CANCELED;
  if (value === COMPLETED) return COMPLETED;
  if (value === CANCELED) return CANCELED;
  return UPCOMING;
}

/**
 * Resolves the authoritative lifecycle state for an event.
 *
 * Cancellation always wins. Otherwise the schedule decides, so contradictory
 * date/status metadata degrades to the safe outcome instead of promoting a past
 * event. Only when the schedule cannot be derived at all does the stored status
 * win, which keeps malformed content renderable.
 *
 * @param {EventData | { data?: EventData }} event
 * @param {Date | number} [now]
 * @returns {EventLifecycleStatus}
 */
export function resolveEventStatus(event, now = new Date()) {
  const data = toEventData(event);

  if (isEventCanceled(data)) return CANCELED;

  const schedule = getEventSchedule(data);
  if (!schedule) return normalizeStoredStatus(data.status);

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return normalizeStoredStatus(data.status);

  return nowMs >= schedule.endsAt.getTime() ? COMPLETED : UPCOMING;
}

/**
 * @param {EventData | { data?: EventData }} event
 * @param {Date | number} [now]
 * @returns {boolean}
 */
export function isEventUpcoming(event, now = new Date()) {
  return resolveEventStatus(event, now) === UPCOMING;
}

/**
 * @param {EventData | { data?: EventData }} event
 * @param {Date | number} [now]
 * @returns {boolean}
 */
export function isEventPast(event, now = new Date()) {
  return resolveEventStatus(event, now) === COMPLETED;
}

/**
 * Sort key for an event: its absolute start, with unknown schedules pushed last.
 * @param {EventData | { data?: EventData }} event
 * @returns {number}
 */
function getStartSortKey(event) {
  const schedule = getEventSchedule(event);
  return schedule ? schedule.startsAt.getTime() : Number.POSITIVE_INFINITY;
}

/**
 * @template T
 * @param {T[]} events
 * @param {{ descending?: boolean }} [options]
 * @returns {T[]}
 */
export function sortEventsByStart(events, options = {}) {
  const { descending = false } = options;
  return [...events].sort((a, b) => {
    const delta = getStartSortKey(a) - getStartSortKey(b);
    if (delta !== 0) return descending ? -delta : delta;
    return String(/** @type {{ slug?: string }} */ (a)?.slug ?? '').localeCompare(
      String(/** @type {{ slug?: string }} */ (b)?.slug ?? '')
    );
  });
}

/**
 * Upcoming events, nearest first. Expired events with stale `upcoming` metadata are excluded.
 * @template T
 * @param {T[]} events
 * @param {Date | number} [now]
 * @returns {T[]}
 */
export function selectUpcomingEvents(events, now = new Date()) {
  return sortEventsByStart(
    events.filter((event) => resolveEventStatus(event, now) === UPCOMING),
    { descending: false }
  );
}

/**
 * Archived events, most recent first.
 * @template T
 * @param {T[]} events
 * @param {Date | number} [now]
 * @returns {T[]}
 */
export function selectPastEvents(events, now = new Date()) {
  return sortEventsByStart(
    events.filter((event) => resolveEventStatus(event, now) === COMPLETED),
    { descending: true }
  );
}

/**
 * Explicitly cancelled events, most recently scheduled first.
 * @template T
 * @param {T[]} events
 * @param {Date | number} [now]
 * @returns {T[]}
 */
export function selectCanceledEvents(events, now = new Date()) {
  return sortEventsByStart(
    events.filter((event) => resolveEventStatus(event, now) === CANCELED),
    { descending: true }
  );
}

/**
 * Event statistics derived from resolved lifecycle state, so every consumer
 * (homepage, archive, telemetry) reports the same numbers as the rendered cards.
 * @template T
 * @param {T[]} events
 * @param {Date | number} [now]
 * @returns {{ total: number, upcoming: number, completed: number, canceled: number }}
 */
export function countEventsByLifecycle(events, now = new Date()) {
  const counts = { total: events.length, upcoming: 0, completed: 0, canceled: 0 };

  for (const event of events) {
    switch (resolveEventStatus(event, now)) {
      case COMPLETED:
        counts.completed += 1;
        break;
      case CANCELED:
        counts.canceled += 1;
        break;
      default:
        counts.upcoming += 1;
    }
  }

  return counts;
}

/**
 * Formats a bare calendar date for display without depending on the build machine timezone.
 * @param {string | undefined | null} rawDate
 * @param {{ weekday?: boolean }} [options]
 * @returns {string}
 */
export function formatEventDateLabel(rawDate, options = {}) {
  const { weekday = false } = options;
  const calendarDate = parseCalendarDate(typeof rawDate === 'string' ? rawDate.trim() : '');
  if (!calendarDate) return typeof rawDate === 'string' && rawDate.trim() ? rawDate.trim() : 'Date TBA';

  // Noon UTC keeps the calendar day stable in every build environment.
  const anchor = new Date(Date.UTC(calendarDate.year, calendarDate.month - 1, calendarDate.day, 12));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    ...(weekday ? { weekday: 'long' } : {}),
    month: weekday ? 'long' : 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(anchor);
}

/**
 * ISO timestamp the countdown should count down to, or null when unschedulable.
 * @param {EventData | { data?: EventData }} event
 * @returns {string | null}
 */
export function getEventStartTimestamp(event) {
  const schedule = getEventSchedule(event);
  return schedule ? schedule.startsAt.toISOString() : null;
}
