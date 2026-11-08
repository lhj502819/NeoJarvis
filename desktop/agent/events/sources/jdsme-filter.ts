/** 群白名单语义：未配置(空数组) = 不筛选、放行全部群；配置了则只放行列出的群。 */
export function isGroupAllowed(groupId: string, whitelist: string[]): boolean {
  return whitelist.length === 0 || whitelist.includes(groupId)
}
