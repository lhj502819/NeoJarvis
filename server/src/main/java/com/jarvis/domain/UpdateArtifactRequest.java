package com.jarvis.domain;

import jakarta.validation.constraints.NotNull;

/**
 * Body for {@code PATCH /api/artifact/{id}} (ports tools.ts update_artifact). {@code content}
 * is required but may be empty (the TS tool always passes a string); {@code title} is optional
 * — when omitted the stored title is preserved.
 */
public record UpdateArtifactRequest(
        @NotNull String content,
        String title) {
}
