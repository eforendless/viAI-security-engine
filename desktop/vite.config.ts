import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/engine": {
        target: "http://127.0.0.1:4117",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/engine/, ""),
      },
    },
  },
})
