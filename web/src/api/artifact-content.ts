/**
 * 前端制品正文读取适配器 (v0.3 file-store)。
 *
 * v0.3 后 Java 返回的制品对象是 `content XOR uri`:
 *   - 新数据: 只带 uri (格式 `file://...` 指向本机文件, 或将来 OSS 的 `https://...`)
 *   - 老数据: 只带 content (迁移前落库的 TEXT 正文)
 *
 * 前端组件不管存储后端, 通过这里拿到最终的字符串正文渲染. 三条路径:
 *   1. content 已在对象里 -> 直接用 (老数据 / SSE 推送 / PATCH 回显)
 *   2. uri 是 http(s):// -> fetch(远端 OSS)
 *   3. uri 是 file:// -> Electron IPC (走主进程读白名单目录里的文件)
 *
 * Web-only (纯浏览器) 环境下拿到 file:// 是异常场景 —— 只在 Electron 里才有效.
 */

export interface ArtifactLike {
  uri?: string | null
  content?: string | null
}

/**
 * 主进程 preload 暴露的桥. 见 desktop/preload/index.js.
 */
interface JarvisBridge {
  isDesktop?: boolean
  platform?: string
  readArtifact?: (uri: string) => Promise<string>
}

function getBridge(): JarvisBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { jarvis?: JarvisBridge }).jarvis
}

/**
 * 加载制品正文. content 优先 (最常见 & 已在手上), 其次按 uri 协议路由.
 * 抛错场景:
 *   - 既无 content 又无 uri (数据错乱)
 *   - uri 是 file:// 但当前不是 Electron (纯浏览器打开时的兜底提示)
 *   - uri 是未知协议
 */
export async function loadArtifactContent(artifact: ArtifactLike): Promise<string> {
  if (typeof artifact.content === 'string' && artifact.content.length > 0) {
    return artifact.content
  }
  const uri = artifact.uri
  if (!uri) {
    throw new Error('制品无 uri 也无 content')
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const res = await fetch(uri)
    if (!res.ok) throw new Error(`加载制品失败: HTTP ${res.status}`)
    return await res.text()
  }
  if (uri.startsWith('file://')) {
    const bridge = getBridge()
    if (bridge?.readArtifact) {
      return await bridge.readArtifact(uri)
    }
    throw new Error('无法读取本机制品: 非 Electron 环境')
  }
  throw new Error(`未知的制品 uri 协议: ${uri}`)
}
