// packages/server/src/task/schedule.ts
// Cron expressions for recurring tasks.
//
// Standard 5-field cron (minute hour day-of-month month day-of-week), with
// `*`, lists (`1,2`), ranges (`1-5`), steps (`*/15`) and the usual
// day-of-week/day-of-month names. Times are UTC — a task belongs to a project
// and the server is the only clock that matters for a background job.
//
// The parser is deliberately small and total: an expression it cannot parse
// returns undefined, and the task simply never fires.

export interface CronFields {
  readonly minutes: ReadonlySet<number>
  readonly hours: ReadonlySet<number>
  readonly daysOfMonth: ReadonlySet<number>
  readonly months: ReadonlySet<number>
  readonly daysOfWeek: ReadonlySet<number>
  /** true when the day-of-month field was `*` (the usual "every day" case). */
  readonly everyDayOfMonth: boolean
  /** true when the day-of-week field was `*`. */
  readonly everyDayOfWeek: boolean
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

const names = (value: string, table: ReadonlyArray<string>): number | undefined => {
  const index = table.indexOf(value.slice(0, 3).toLowerCase())
  return index < 0 ? undefined : index
}

function parseField(
  raw: string,
  min: number,
  max: number,
  table: ReadonlyArray<string> = [],
): { values: Set<number>; wildcard: boolean } | undefined {
  const values = new Set<number>()
  let wildcard = true

  for (const part of raw.split(",")) {
    const [range, stepRaw] = part.split("/")
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step <= 0) return undefined

    let from = min
    let to = max
    if (range !== "*" && range !== "?") {
      const [fromRaw, toRaw] = range.split("-")
      const parsedFrom = names(fromRaw ?? "", table) ?? Number(fromRaw)
      const parsedTo = toRaw === undefined ? undefined : (names(toRaw, table) ?? Number(toRaw))
      if (!Number.isFinite(parsedFrom) || parsedFrom < min || parsedFrom > max) return undefined
      from = parsedFrom
      if (parsedTo !== undefined) {
        if (!Number.isFinite(parsedTo) || parsedTo < min || parsedTo > max) return undefined
        to = parsedTo
      } else if (stepRaw !== undefined) {
        to = max
      } else {
        to = parsedFrom
      }
      if (to < from) return undefined
      wildcard = false
    }

    for (let value = from; value <= to; value += step) values.add(value)
  }

  if (values.size === 0) return undefined
  return { values, wildcard }
}

export function parseCron(expression: string): CronFields | undefined {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return undefined

  const minute = parseField(fields[0], 0, 59)
  const hour = parseField(fields[1], 0, 23)
  const dayOfMonth = parseField(fields[2], 1, 31)
  const month = parseField(fields[3], 1, 12, MONTHS)
  const dayOfWeek = parseField(fields[4], 0, 7, DAYS)
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return undefined

  // Cron allows 7 for Sunday; normalize it to 0.
  if (dayOfWeek.values.has(7)) {
    dayOfWeek.values.delete(7)
    dayOfWeek.values.add(0)
  }

  return {
    minutes: minute.values,
    hours: hour.values,
    daysOfMonth: dayOfMonth.values,
    months: month.values,
    daysOfWeek: dayOfWeek.values,
    everyDayOfMonth: dayOfMonth.wildcard,
    everyDayOfWeek: dayOfWeek.wildcard,
  }
}

export function isValidCron(expression: string): boolean {
  return parseCron(expression) !== undefined
}

const dayOfWeek = (date: Date) => date.getUTCDay()

/** Does the cron expression match the given UTC date (minute resolution)? */
export function matches(fields: CronFields, date: Date): boolean {
  if (!fields.minutes.has(date.getUTCMinutes())) return false
  if (!fields.hours.has(date.getUTCHours())) return false
  if (!fields.months.has(date.getUTCMonth() + 1)) return false

  const dom = fields.daysOfMonth.has(date.getUTCDate())
  const dow = fields.daysOfWeek.has(dayOfWeek(date))

  // Standard cron rule: when both day fields are restricted, either may match.
  if (!fields.everyDayOfMonth && !fields.everyDayOfWeek) return dom || dow
  return dom && dow
}

const MINUTE = 60_000

/**
 * The next time the expression fires after `from` (UTC), or undefined when the
 * expression can never fire. Bounded to four years of minutes so a bogus
 * expression cannot spin forever.
 */
export function nextRun(expression: string, from: Date = new Date()): Date | undefined {
  const fields = parseCron(expression)
  if (!fields) return undefined

  const start = new Date(Math.floor(from.getTime() / MINUTE) * MINUTE + MINUTE)
  const limit = 366 * 24 * 60 * 4
  for (let step = 0; step < limit; step++) {
    const candidate = new Date(start.getTime() + step * MINUTE)
    if (matches(fields, candidate)) return candidate
  }
  return undefined
}

/** Human-readable summary of an expression, for the task list. */
export function describeCron(expression: string): string {
  const fields = parseCron(expression)
  if (!fields) return expression
  const times = (values: ReadonlySet<number>, wildcard: boolean) => (wildcard ? "*" : [...values].sort((a, b) => a - b).join(","))
  return `${times(fields.minutes, false)} ${times(fields.hours, false)} ${times(fields.daysOfMonth, fields.everyDayOfMonth)} ${times(fields.months, false)} ${times(fields.daysOfWeek, fields.everyDayOfWeek)}`
}

export * as TaskSchedule from "./schedule"
