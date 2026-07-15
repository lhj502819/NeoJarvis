package com.jarvis.domain;

/**
 * Persistence view of a single artifact with its content, backing
 * {@code GET /api/artifact/{id}} and {@code PATCH /api/artifact/{id}}. {@code version} is
 * carried so the intelligence-layer callers (tools.ts pin/update, brain.ts pinned context)
 * can render {@code v{version}} — the old TS chat route did not select it, but those
 * internal reads did.
 */
public record ArtifactDetail(
        String id,
        String type,
        String title,
        String content,
        String language,
        int version) {
}
