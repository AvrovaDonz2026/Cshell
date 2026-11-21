import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { i18n } from './i18n'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import './styles/theme.css'
import './styles/base.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(i18n)

const auth = useAuthStore(pinia)
auth.hydrate()

app.mount('#app')
