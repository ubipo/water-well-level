<script lang="ts">
  import { updateConfigValue, type Config } from "./service/config";

  export let config: Config | undefined;
  export let password: string;


  const HUMAN_READABLE_CONFIG_NAMES: Record<string, string> = {
    "sensorDistanceFromBottomMM": "Sensor distance from bottom (mm)",
    "measurementIntervalS": "Measurement interval (s)",
    "numberOfMeasurementsToSkipBetweenUploads": "Number of measurements to skip between uploads (batch upload)",
    "readAuthorizationToken": "Read authorization token",
    "writeAuthorizationToken": "Write authorization token",
    "thresholdMinimumNotificationIntervalS": "Minimum time between notifications (s)",
    "lowerThresholdMM": "Lower threshold (mm)",
    "upperThresholdMM": "Upper threshold (mm)",
    "fastDropAmountMM": "Fast drop amount (mm)",
    "fastDropTimeS": "Fast drop time window (s)",
    "fastRiseAmountMM": "Fast rise amount (mm)",
    "fastRiseTimeS": "Fast rise time window (s)",
  }

  let configStatusText: string | undefined = undefined;

  async function updateConfig(key: string, value: any) {
    if (config == null || String(config[key].value) === String(value)) {
      return;
    }
    try {
      await updateConfigValue(password, key, value);
    } catch (err) {
      console.error(err)
      configStatusText = `Failed to update config: ${err}`
      return
    }
    configStatusText = `Updated config item ${key} to ${value}.`
  }
</script>


{#if configStatusText != null}
<p>{configStatusText}</p>
{/if}
<div>
  {#if config != null}
    {#each Object.entries(config) as [key, { value }]}
      <label>
        {HUMAN_READABLE_CONFIG_NAMES[key] ?? key}
        <input
          type="number"
          value={value}
          on:change={e => updateConfig(key, e.currentTarget.value)} />
        <!--  bind:value={config[key]} -->
      </label>
    {/each}
  {/if}
</div>

