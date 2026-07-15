/*
 * Preload(CommonJS,与主进程一致)。
 *
 * contextIsolation: true 下,渲染进程拿不到 Node API。这里用 contextBridge
 * 暴露一个最小、只读的 window.jarvis 桥,供 UI 做环境判断。
 *
 * 现阶段 UI 仍通过 HTTP(/api、/events)与智能层 server 通信,不需要 IPC 通道,
 * 所以只暴露元信息。将来若把聊天改成 IPC(spec §8.4),在此追加 invoke/on 桥。
 */
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('jarvis', {
  isDesktop: true,
  platform: process.platform,
  // TODO(IPC): 需要主进程↔渲染桥时在此扩展,例如:
  //   send: (channel, payload) => ipcRenderer.invoke(channel, payload),
  //   on:   (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data)),
})
