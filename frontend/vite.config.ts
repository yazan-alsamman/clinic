import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Raise warning threshold now that code splitting is in place
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // Pin heavy vendors to stable, named chunks so browsers can cache them
        // independently from page-specific code.
        manualChunks(id) {
          if (id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react/')) {
            return 'vendor-react'
          }
          if (id.includes('/node_modules/react-router')) {
            return 'vendor-router'
          }
          // xlsx is only imported by DailyReport (lazy). Keeping it in its own
          // chunk ensures the large library never appears in the initial load.
          if (id.includes('/node_modules/xlsx/')) {
            return 'vendor-xlsx'
          }
        },
      },
    },
  },
})
