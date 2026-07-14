package com.jarvis.domain;

/**
 * Flattened persistence view of a conversation message joined to its optional artifact
 * (mirrors the TS chat route SELECT). The service turns this into a
 * {@link ConversationMessage} (artifact ref + parsed image ids).
 */
public record ConversationRow(
        String role,
        String content,
        long timestamp,
        String artifactId,
        String artifactType,
        String artifactTitle,
        String imageIds) {
}
