import { Temporal } from '@js-temporal/polyfill'
import type { Temporal as TemporalType } from '@js-temporal/polyfill'

export type Instant = TemporalType.Instant
export type ZonedDateTime = TemporalType.ZonedDateTime
export type PlainDateTime = TemporalType.PlainDateTime
export type Duration = TemporalType.Duration
export type DurationLike = TemporalType.DurationLike

const { Instant, ZonedDateTime, PlainDateTime, Now, Duration } = Temporal
export { Instant, ZonedDateTime, PlainDateTime, Now, Duration }

export function getUserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
