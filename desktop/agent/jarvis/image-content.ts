import type { ChatImage } from '../shared/types.js'

/**
 * Pi SDK 的图片输入形状。
 * 注意：不是 Anthropic SDK 的 { source: { type:'base64', media_type, data } }。
 */
export interface PiImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export function toImageContents(images?: ChatImage[]): PiImageContent[] | undefined {
  if (!images || images.length === 0) return undefined
  return images.map(img => ({
    type: 'image',
    data: img.data,
    mimeType: img.mediaType,
  }))
}
