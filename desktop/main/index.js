/*
 * Jarvis 桌面主进程(CommonJS)。
 *
 * 为什么 CJS?—— 智能层(src/)是 ESM + TS,在**独立 tsx 子进程**里跑;
 * Electron 主进程本身走最稳的 CJS 默认形态(desktop/package.json 无 "type" 字段)。
 * 两者进程隔离:主进程不 import 任何 TS 智能层代码,只负责拉起子进程 + 开窗口。
 *
 * 职责:
 *   1. 注入 env(JARVIS_SERVER_URL 指向 Java 8080、JARVIS_LOCAL_MODE、透传 ANTHROPIC key)
 *   2. spawn `tsx src/server-entry.ts` 起 PG-free 智能层 server(端口 3000,跳过 initDb)
 *   3. 等 3000 就绪 → 开 BrowserWindow(dev 加载 vite 5180,prod 加载 3000 自服务的 web/dist)
 *   4. macOS 窗口惯例;退出时清理子进程
 */
const { app, BrowserWindow, shell, ipcMain } = require('electron')
const path = require('path')
const os = require('node:os')
const fs = require('node:fs/promises')
const http = require('http')
const { spawn } = require('child_process')

// dev = 未打包(electron . )或显式 NODE_ENV=development
const isDev = !app.isPackaged || process.env.NODE_ENV === 'development'

// 仓库根:dev 时是 desktop 的上级;打包后 extraResources 落在 resources/app
const REPO_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..', '..')

const TS_SERVER_PORT = 3000
const VITE_DEV_PORT = 5180

let serverProc = null
let mainWindow = null

/** 组装智能层子进程的环境变量 */
function buildServerEnv() {
  return {
    ...process.env,
    // 数据层走 Java(server-client.ts 读这个变量,默认也是 8080)
    JARVIS_SERVER_URL: process.env.JARVIS_SERVER_URL || 'http://localhost:8080',
    // 单机桌面模式标记(智能层目前未消费,预留;设置无害)
    JARVIS_LOCAL_MODE: '1',
    // 让子进程以脚本模式识别自己(server-entry.ts 的 isMain 判定)
    NODE_ENV: isDev ? 'development' : 'production',
    // ANTHROPIC key:本地阶段从当前进程 env 透传;
    // TODO(BYOK): 后续从 macOS keychain 读取,不再依赖启动环境。
  }
}

// ═══ IPC: 制品文件读取(v0.3 file-store) ═══
// v0.3 后制品正文写到 `~/.jarvis/artifacts/{userId}/{id}.{ext}`,Java 只返回 uri。
// 渲染进程拿到 uri 后需要读文件正文渲染 —— 由主进程借助 fs 完成,渲染进程无 Node 权限。
// 白名单:仅允许读 `~/.jarvis/artifacts/` 下的路径,防止路径穿越读到其它文件。
const ARTIFACT_ROOT = path.join(os.homedir(), '.jarvis', 'artifacts') + path.sep
ipcMain.handle('artifact:read', async (_event, uri) => {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('artifact:read expects a non-empty uri')
  }
  const raw = uri.replace(/^file:\/\//, '')
  // resolve so `..` / symlinks in the middle can't escape the root
  const resolved = path.resolve(raw)
  if (!resolved.startsWith(ARTIFACT_ROOT)) {
    throw new Error(`artifact uri out of scope: ${uri}`)
  }
  return await fs.readFile(resolved, 'utf-8')
})

/** spawn tsx 跑 src/server-entry.ts —— 用 Electron 自带 node 执行 tsx CLI,不依赖系统 PATH */
function startTsServer() {
  const tsxCli = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const entry = path.join(REPO_ROOT, 'src', 'server-entry.ts')

  serverProc = spawn(process.execPath, [tsxCli, entry], {
    cwd: REPO_ROOT,
    env: {
      ...buildServerEnv(),
      ELECTRON_RUN_AS_NODE: '1', // 让 Electron 二进制当纯 node 用
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProc.stdout.on('data', (d) => process.stdout.write(`[ts-server] ${d}`))
  serverProc.stderr.on('data', (d) => process.stderr.write(`[ts-server] ${d}`))
  serverProc.on('exit', (code, signal) => {
    console.log(`[ts-server] 退出 code=${code} signal=${signal}`)
    serverProc = null
  })
}

/** 轮询 3000 直到可连接(智能层 server ready) */
function waitForServer(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: 'localhost', port, path: '/api/health', timeout: 1500 }, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() > deadline) return reject(new Error(`TS server 未在 ${timeoutMs}ms 内就绪`))
        setTimeout(tick, 400)
      })
      req.on('timeout', () => { req.destroy() })
    }
    tick()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    title: 'Jarvis',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0e1a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // dev → vite dev server(HMR);prod → 智能层 server 自服务的 web/dist(同源,/api /events 直连)
  const url = isDev
    ? `http://localhost:${VITE_DEV_PORT}`
    : `http://localhost:${TS_SERVER_PORT}`

  mainWindow.loadURL(url)
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })

  // 外链走系统浏览器,不在应用内开新窗
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  startTsServer()
  try {
    await waitForServer(TS_SERVER_PORT)
    console.log('[main] TS 智能层 server 就绪')
  } catch (e) {
    console.error('[main] 等待 TS server 超时:', e.message, '——仍尝试开窗(dev 下 vite 独立运行)')
  }
  createWindow()

  // macOS:点 Dock 图标且无窗口时重建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// macOS 惯例:关掉所有窗口不退出应用(留在 Dock)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 退出前清理智能层子进程
app.on('before-quit', () => {
  if (serverProc) {
    serverProc.kill('SIGTERM')
    serverProc = null
  }
})
