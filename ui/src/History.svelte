<script lang="ts">
  import Chart, {
    type ChartData,
    type ChartTypeRegistry,
    type TooltipOptions,
  } from "chart.js/auto";
  import debounce from "lodash/debounce";
  import type { Measurement } from "./service/measurement";
  import {
    Now,
    PlainDateTime,
    ZonedDateTime,
    type DurationLike,
    Instant,
    getUserTimeZone,
  } from "./service/temporal";
  import type { ChangeEventHandler } from "svelte/elements";
  import type { Config } from "./service/config";

  export let config: Config | undefined;
  export let measurements: Measurement[] | undefined;

  interface ChartDataPoint extends Measurement {
    dateTimeS: number;
  }

  function measurementsToChartData(measurements: Measurement[]) {
    return measurements.map(
      (measurement) =>
        ({
          ...measurement,
          dateTimeS: measurement.dateTime.epochSeconds,
        } as ChartDataPoint)
    );
  }

  function dateTimeToLabel(
    previousDateTime: ZonedDateTime | undefined,
    dateTime: ZonedDateTime
  ) {
    const previousDateIsSame =
      previousDateTime != null &&
      previousDateTime.toPlainDate().equals(dateTime.toPlainDate());
    if (previousDateIsSame) {
      const [prevHour, hour] = [previousDateTime.hour, dateTime.hour];
      const formatted = dateTime.toPlainTime().toLocaleString([], {
        hour: prevHour === hour ? undefined : "2-digit",
        minute: "2-digit",
      });
      const cycleIsSame = Math.floor(prevHour / 12) === Math.floor(hour / 12);
      return cycleIsSame ? formatted.replace(/AM|PM/, "") : formatted;
    }

    return dateTime.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  let endDateTime = Now.zonedDateTimeISO();
  let endDateTimeIsValid = true;
  let interval = 7;
  let intervalUnit: keyof DurationLike = "days";

  const handleEndDateTimeChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const maybePlainEndDateTime = (() => {
      try {
        return PlainDateTime.from(e.currentTarget.value);
      } catch (err) {
        if (err instanceof RangeError) {
          return null;
        }
        throw err;
      }
    })();
    if (maybePlainEndDateTime == null) {
      e.currentTarget.setCustomValidity("Invalid date/time");
      e.currentTarget.reportValidity();
      endDateTimeIsValid = false;
      return;
    }
    e.currentTarget.setCustomValidity("");
    endDateTimeIsValid = true;
    endDateTime = maybePlainEndDateTime.toZonedDateTime(getUserTimeZone());
  };

  let chartCanvas: HTMLCanvasElement;
  let chartContainer: HTMLDivElement;

  let chart: Chart<keyof ChartTypeRegistry, ChartDataPoint[]> | undefined =
    undefined;
  let noData = false;

  $: (() => {
    if (!chartCanvas || !measurements || !config || chart) return;
    noData = measurements.length === 0;
    if (noData) return;
    const chartData = measurementsToChartData(measurements);
    const { value: lowerThreshold } = config["lowerThresholdMM"];
    const { value: upperThreshold } = config['upperThresholdMM']
    chart = new Chart(chartCanvas, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "Water level",
            data: chartData,
            showLine: true,
            borderColor: "rgba(108, 220, 240, 1)",
            backgroundColor: "rgba(108, 220, 240, 0.4)",
            pointBackgroundColor: "rgba(108, 220, 240, 1)",
            pointBorderColor: (context) => {
              const { datasetIndex, dataIndex, chart } = context;
              const { data } = chart.data.datasets[datasetIndex];
              const { waterLevelMM } = data[
                dataIndex
              ] as unknown as ChartDataPoint;
              const isWithinLimits =
                waterLevelMM >= lowerThreshold &&
                waterLevelMM <= upperThreshold;
              return isWithinLimits ? "rgba(99, 255, 132, 1)" : "rgba(255, 99, 132, 1)";
            },
            tooltip: {
              callbacks: {
                label(context) {
                  const { datasetIndex, dataIndex, chart } = context;
                  const { data } = chart.data.datasets[datasetIndex];
                  const { waterLevelMM } = data[
                    dataIndex
                  ] as unknown as ChartDataPoint;
                  return `Water level: ${(waterLevelMM / 1000).toFixed(2)} m`;
                },
              },
            } as TooltipOptions<"scatter">,
            parsing: {
              yAxisKey: "waterLevelMM",
            },
          },
          {
            label: "Battery voltage",
            data: chartData,
            // fill: {
            //   target: {
            //     value: 3.3,
            //   },
            //   below: "rgba(255, 99, 132, 0.2)", // Area will be red below the origin
            //   // And green above the origin
            //   above: "rgba(99, 255, 132, 0.2)",
            // },
            showLine: true,
            // @ts-ignore
            tooltip: {
              callbacks: {
                label(context) {
                  const { datasetIndex, dataIndex, chart } = context;
                  const { data } = chart.data.datasets[datasetIndex];
                  const { batteryVoltage } = data[
                    dataIndex
                  ] as unknown as ChartDataPoint;
                  if (batteryVoltage == null) return "Unknown";
                  return `Battery voltage: ${batteryVoltage.toFixed(2)} V`;
                },
              },
            } as TooltipOptions<"scatter">,
            borderColor: "rgba(245, 237, 0, 0.9)",
            backgroundColor: "rgba(245, 237, 0, 0.4)",
            pointBackgroundColor: "rgba(245, 237, 0, 0.4)",
            pointBorderColor: "rgba(245, 237, 0, 0.9)",
            parsing: {
              yAxisKey: "batteryVoltage",
            },
            yAxisID: "batteryVoltage",
          },
        ],
      } as ChartData<"scatter", ChartDataPoint[]>,
      options: {
        parsing: {
          xAxisKey: "dateTimeS",
        },
        plugins: {
          tooltip: {
            callbacks: {
              beforeBody(tooltipItems) {
                const { datasetIndex, dataIndex, chart } = tooltipItems[0];
                const { data } = chart.data.datasets[datasetIndex];
                const { dateTime } = data[
                  dataIndex
                ] as unknown as ChartDataPoint;
                return dateTime.toLocaleString();
              },
            },
          },
        },
        scales: {
          y: {
            min: 0,
            title: {
              text: "Water level (m)",
              display: true,
            },
            ticks: {
              callback(tickValue, _index, _ticks) {
                return `${(Number(tickValue) / 1000).toFixed(2)}`;
              },
            },
          },
          batteryVoltage: {
            min: 2,
            max: 5,
            title: {
              text: "Battery voltage (V)",
              display: true,
            },
            position: "right",
            grid: {
              drawOnChartArea: false,
            },
          },
          x: {
            min: chartData[0].dateTimeS,
            max: chartData[chartData.length - 1].dateTimeS,
            type: "linear",
            title: {
              text: `Date & time (${endDateTime.timeZoneId} ${endDateTime.offset})`,
              display: true,
            },
            ticks: {
              callback(tickValue, index, ticks) {
                const previousTick = ticks[index - 1];
                const previousDateTime = previousTick?.value
                  ? Instant.fromEpochSeconds(
                      previousTick.value
                    ).toZonedDateTimeISO("UTC")
                  : undefined;
                const dateTime = Instant.fromEpochSeconds(
                  Number(tickValue)
                ).toZonedDateTimeISO("UTC");
                return dateTimeToLabel(previousDateTime, dateTime);
              },
              autoSkip: false,
              maxTicksLimit: 500,
            },
          },
        },
      },
    });
  })();

  let endDateTimeStatusText = "";

  $: (() => {
    if (!chart || !measurements) return;
    const startDateTime = endDateTime.subtract({ [intervalUnit]: interval });
    let earliestIndex = 0;
    let latestIndex = measurements.length;
    for (let i = 0; i < measurements.length; i++) {
      const { dateTime } = measurements[i];
      if (i <= earliestIndex) {
        if (ZonedDateTime.compare(dateTime, startDateTime) < 0) {
          earliestIndex++;
        }
      }
      if (i - 1 <= latestIndex) {
        if (ZonedDateTime.compare(dateTime, endDateTime) <= 0) {
          latestIndex = i;
        }
      }
    }
    const filtered = measurements.slice(earliestIndex, latestIndex + 1);
    noData = filtered.length === 0;
    const numberNotShownAfter = measurements.length - latestIndex - 1;
    endDateTimeStatusText = `Showing ${filtered.length} of ${measurements.length} records (${earliestIndex} before start time not shown, ${numberNotShownAfter} after end time not shown).`;
    if (noData) return;
    const chartData = measurementsToChartData(filtered);
    for (const dataset of chart.data.datasets) {
      dataset.data = chartData;
    }
    if (chartData.length > 0) {
      chart.options.scales!!.x!!.min = chartData[0].dateTimeS;
      chart.options.scales!!.x!!.max =
        chartData[chartData.length - 1].dateTimeS;
      chartData[chartData.length - 1].dateTimeS;
    }
    chart.update();
  })();

  let previousWidth: number = NaN;

  const debouncedChartUpdate = debounce(() => {
    if (!chart || !chartContainer) return;
    const width = chartContainer.clientWidth;
    if (width === previousWidth) return;
    chartContainer.style.height = `${width / 2}px`;
  }, 20);

  let resizeObserver: ResizeObserver | undefined = undefined;

  $: (() => {
    if (!chartContainer || resizeObserver) return;
    resizeObserver = new ResizeObserver(debouncedChartUpdate);
    resizeObserver.observe(chartContainer);
  })();
</script>

<p id="measurement-history-error" class="error" />
<div class="input-btn-group">
  <label>
    <span>
      End time
      {#if !endDateTimeIsValid} (<span class="invalid">invalid</span>){/if}
    </span>
    <input
      type="datetime-local"
      value={endDateTime
        .toPlainDateTime()
        .toString({ fractionalSecondDigits: 0 })}
      on:change={handleEndDateTimeChange}
    />
  </label>
  <button class="reset" on:click={() => (endDateTime = Now.zonedDateTimeISO())}>
    Reset
  </button>
</div>
<span>{endDateTimeStatusText}</span>
<label>
  Interval
  <input type="number" min="0" bind:value={interval} />
  <select bind:value={intervalUnit}>
    <option value="seconds">seconds</option>
    <option value="minutes">minutes</option>
    <option value="hours">hours</option>
    <option value="days">days</option>
    <option value="weeks">weeks</option>
    <option value="months">months</option>
  </select>
</label>
<button id="fetch">Fetch</button>
<div class="chart-container" bind:this={chartContainer}>
  {#if noData}
    <p class="no-data">No data</p>
  {/if}
  <canvas bind:this={chartCanvas} class:hidden={noData} />
</div>

<style>
  .invalid {
    color: #c31515;
  }

  .no-data {
    text-align: center;
    font-size: 1.5em;
    margin: 0;
  }

  .hidden {
    display: none !important;
  }

  button.reset {
    margin-bottom: 0.2em;
  }

  .input-btn-group {
    display: flex;
    flex-direction: row;
    justify-content: start;
    align-items: top;
    margin-bottom: 1em;
  }

  .input-btn-group > label {
    flex-grow: 1;
    margin-bottom: 0;
    margin-right: 0.25em;
  }

  .input-btn-group > button {
    margin-bottom: 0;
  }

  .chart-container {
    max-width: 100%;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  canvas {
    width: 20rem;
  }
</style>
