<script lang="ts">
import Configuration from "./Configuration.svelte";
import History from "./History.svelte";
import Latest from "./Latest.svelte";
import debounce from 'lodash/debounce';

import { fetchMeasurements } from "./service/measurement";
import type { Measurement } from "./service/measurement";
import { fetchConfig, type Config } from "./service/config";


const PASSWORD_LOCAL_STORAGE_KEY = "password"

let password = localStorage.getItem(PASSWORD_LOCAL_STORAGE_KEY) ?? ""
$: password, localStorage.setItem(PASSWORD_LOCAL_STORAGE_KEY, password)

let measurements: Measurement[] | undefined = undefined
let measurementsFuture: Promise<Measurement[]>
const debouncedFetchMeasurements = debounce(async () => {
  measurementsFuture = fetchMeasurements(password)
  measurements = await measurementsFuture
}, 1000)
$: password, debouncedFetchMeasurements()

let config: Config | undefined = undefined
const configFuture = (async () => {
  config = await fetchConfig(password)
})()

</script>

<main>
  <h1>Water Level</h1>

  <label>
    Password
    <input type="password" bind:value={password}>
  </label>

  {#await measurementsFuture}
    <p>Loading measurements...</p>
  {:catch error}
    <p>An error occurred while loading the measurements: {error.message}</p>
  {/await}

  {#await configFuture}
  <p>Loading config...</p>
  {:catch error}
  <p>An error occurred while loading the configuration: {error.message}</p>
  {/await}

  <section>
    <h2>Latest measurement</h2>
    <Latest config={config} measurement={measurements?.slice(-1)[0]} />
  </section>

  <section>
    <h2>Measurement history</h2>
    <History measurements={measurements} config={config} />
  </section>

  <section>
    <h2>Configuration</h2>
    <Configuration config={config} password={password} />
  </section>
</main>

<style>

main {
  padding: 1rem;
  padding-top: 3rem;
  max-width: 60rem;
  width: 100%;
}

section {
  width: 100%;
}

</style>
