import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build works under GitHub Pages' /satisfactory-tools/ path
export default defineConfig({
  plugins: [react()],
  base: './',
})
