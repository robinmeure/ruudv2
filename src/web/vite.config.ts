import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Under Aspire the API address arrives through service discovery variables; standalone runs fall back to the API's launch profile.
const apiTarget =
  process.env.services__api__https__0 ??
  process.env.services__api__http__0 ??
  process.env.API_HTTPS ??
  process.env.API_HTTP ??
  'http://localhost:5137'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, secure: false },
    },
  },
})
