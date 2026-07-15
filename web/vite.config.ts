import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const TS = 'http://localhost:3000'   // 老 TS 全栈(智能层 + CRUD)
const JAVA = 'http://localhost:8080' // v0.3 Java 服务端(纯 CRUD)

// VITE_JAVA_BACKEND=1 时:把 Java 已实现的数据类 endpoint 分流到 8080,
// 聊天 / agent / events / auth 仍走老 TS 3000(Java 未实现智能层)。
// 默认(不设该变量)全走 3000,现有开发不受影响。
const useJava = process.env.VITE_JAVA_BACKEND === '1'

// Java A0-A4 已实现的数据类精确路径(其余 /api 留 3000)
const javaProxy: Record<string, string> = useJava
  ? {
      '/api/tasks': JAVA,
      '/api/task': JAVA,
      '/api/state': JAVA,
      '/api/history': JAVA,
      '/api/recipes': JAVA,
      '/api/recipe': JAVA,
      '/api/artifacts': JAVA,
      '/api/artifact': JAVA,
      '/api/credentials': JAVA,
      '/api/conversation': JAVA,
      '/api/chat-image': JAVA,
      '/api/health': JAVA,
      // 注意:/api/skills Java 改成了 /api/skills/prefs,前端路径对不上,
      // 暂留 3000 —— 分流验证正是要暴露这类契约差异。
    }
  : {}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    host: true,
    proxy: {
      // Java 分流规则放最前(vite proxy 按声明顺序最长前缀匹配)
      ...javaProxy,
      '/chat': TS,
      '/tasks': TS,
      '/events': TS,
      '/api': TS,
      '/auth': TS,
    },
  },
})
