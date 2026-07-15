/*
 * Preload(CommonJS,与主进程一致)。
 *
 * contextIsolation: true 下,渲染进程拿不到 Node API。这里用 contextBridge
 * 暴露一个最小、只读的 window.jarvis 桥,供 UI 做环境判断。
 *
 * 现阶段 UI 仍通过 HTTP(/api、/events)与智能层 server 通信,不需要 IPC 通道,
 * 所以只暴露元信息;例外:v0.3 制品正文改成本机文件,渲染进程需要通过 IPC
 * 从主进程读文件(白名单在主进程 ipcMain.handle('artifact:read') 里)。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvis', {
  isDesktop: true,
  platform: process.platform,
  /**
   * 读一个制品文件的正文。传入 Java 返回的 uri(格式 `file:///.../.jarvis/artifacts/{userId}/{id}.{ext}`),
   * 主进程校验后从磁盘读回 UTF-8 字符串。前端 loadArtifactContent 会在 file:// 时优先调它。
   */
  readArtifact: (uri) => ipcRenderer.invoke('artifact:read', uri),
})
