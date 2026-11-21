import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ command }) => {
  const base =
    process.env.VITE_BASE ?? (command === 'build' ? '/_cshell/' : '/')

  return {
    base,
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
      },
    },
  }
})
