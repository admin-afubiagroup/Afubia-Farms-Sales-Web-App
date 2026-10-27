import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('xlsx')) return 'spreadsheets';
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('firebase') || id.includes('@firebase')) return 'firebase';
          }
        }
      }
    }
  }
})
