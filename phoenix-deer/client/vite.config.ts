import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 👇 any request starting with /api will be forwarded to backend
      '/api': {
        target: 'http://localhost:5050', // your Express server
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
