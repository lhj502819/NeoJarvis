package com.jarvis.domain;

/**
 * Persistence view of a single artifact with its content, backing
 * {@code GET /api/artifact/{id}} (mirrors the TS chat route SELECT).
 */
public record ArtifactDetail(
        String id,
        String type,
        String title,
        String content,
        String language) {
}
