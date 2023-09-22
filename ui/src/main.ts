import './app.css'
import App from './App.svelte'

const target = document.querySelector('#app')
if (target == null) {
  throw new Error('No #app element')
}
const app = new App({ target })

export default app
