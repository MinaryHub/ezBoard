import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' : 데스크톱(file://)과 안드로이드 앱에서 상대 경로로 자원을 불러오기 위함
export default defineConfig({
  base: './',
  plugins: [react()],
})
