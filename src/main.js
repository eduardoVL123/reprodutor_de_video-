import './polyfills'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import { initSpatialNavigation } from './utils/spatialNavigation'
import { applyCompatClasses } from './utils/compat'
import { installDevTools } from './utils/devTools'
import { installErrorCapture } from './services/errorLog'

applyCompatClasses()
if (import.meta.env.DEV) installDevTools()
initSpatialNavigation({ router })

const app = createApp(App)
installErrorCapture(app)
app.use(createPinia()).use(router).mount('#app')

