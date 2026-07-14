package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;

/**
 * Body for {@code POST /api/artifacts} (ports the internal TS {@code saveArtifact}).
 * {@code language} and {@code taskId} are optional; {@code version} is not accepted — the
 * DB defaults it to 1 on insert, matching the TS INSERT which never set it.
 */
public record SaveArtifactRequest(
        @NotBlank String type,
        @NotBlank String title,
        @NotBlank String content,
        String language,
        String taskId) {
}
