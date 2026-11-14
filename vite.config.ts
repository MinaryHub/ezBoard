import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// base './' : 데스크톱(file://)과 안드로이드 앱에서 상대 경로로 자원을 불러오기 위함
export default defineConfig({
  base: './',
  plugins: [react()],
  // 앱 버전: 업데이트 확인과 문의하기에 쓴다 (package.json 한 곳에서만 정한다)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})
