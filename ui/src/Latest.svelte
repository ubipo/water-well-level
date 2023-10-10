<script lang="ts">
import type { Config } from "./service/config";
import type { Measurement } from "./service/measurement";
import { Now, ZonedDateTime } from "./service/temporal";

export let config: Config | undefined;
export let measurement: Measurement | undefined;

enum Limits {
  Low = "Low",
  High = "High",
  Ok = "Within limits",
}

$: limit = (() => {
  if (!config || !measurement) return null
  const { value: lowerThreshold } = config.lowerThresholdMM
  const { value: upperThreshold } = config.upperThresholdMM
  if (measurement.waterLevelMM < lowerThreshold) return Limits.Low
  if (measurement.waterLevelMM > upperThreshold) return Limits.High
  return Limits.Ok
})()

function dateTimeToTimeAgoString(dateTime: ZonedDateTime) {
  const now = Now.zonedDateTimeISO("UTC")
  const diff = dateTime.toInstant().until(now.toInstant())
  const isPast = diff.sign === -1
  const seconds = diff.total("seconds")
  const minutes = diff.total('minutes')
  const whole = (n: number) => n.toFixed(0)
  if (minutes < 1) return isPast ? `in ${whole(seconds)} seconds` : `${whole(seconds)} seconds ago`
  const hours = diff.total('hours')
  if (hours < 1) return isPast ? `in ${whole(minutes)} minutes` : `${whole(minutes)} minutes ago`
  const days = diff.total('days')
  if (days < 1) return isPast ? `in ${whole(hours)} hours` : `${whole(hours)} hours ago`
  return isPast ? `in ${whole(days)} days` : `${whole(days)} days ago`
}
</script>

<p>
  Latest measurement:
</p>
<p>
  <span class="value">{
    measurement ? (measurement.waterLevelMM / 1000).toFixed(2) : "--"
  }</span> m - 
  <span
    class="limitsText"
    class:outside-limits={limit != Limits.Ok && limit != null}
    class:within-limits={limit == Limits.Ok}>
    {limit ?? "--"}
  </span>
</p>
<p>
  <span>{
    measurement
      ? `${measurement.batteryVoltage ?? "--"}V - ${dateTimeToTimeAgoString(measurement.dateTime)} - ${measurement.dateTime.toLocaleString()}`
      : "--"
  }</span>
</p>

<style>
  p {
    margin: 0;
    margin-bottom: 0.4em;
  }

  .value {
    font-weight: bold;
    font-size: 14pt;
  }

  .limitsText {
    font-weight: bold;
    font-size: 14pt;
  }

  .outside-limits {
    color: #ff9800;
  }

  .within-limits {
    color: #128516;
  }
</style>
