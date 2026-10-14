import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import { initSpatialNavigation } from './utils/spatialNavigation'

initSpatialNavigation({ router })

createApp(App).use(createPinia()).use(router).mount('#app')

