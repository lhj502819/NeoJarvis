package com.jarvis.domain;

/**
 * Flattened persistence view of a conversation message joined to its optional artifact
 * (mirrors the TS chat route SELECT). The service turns this into a
 * {@link ConversationMessage} (artifact ref + parsed image ids).
 *
 * <p>{@code id} 是 user_jarvis_messages 的 SERIAL 主键,TS 侧用它去查
 * {@code GET /api/message/{id}/tool-traces},让 Jarvis 下一轮 think() 能看到
 * 自己上一轮调过的工具。
 */
public record ConversationRow(
        long id,
        String role,
        String content,
        long timestamp,
        String artifactId,
        String artifactType,
        String artifactTitle,
        String imageIds) {
}
