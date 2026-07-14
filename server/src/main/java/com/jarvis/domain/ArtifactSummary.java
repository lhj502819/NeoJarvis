package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Artifact summary embedded in {@link TaskDetail} (matches the TS getTaskDetail
 * artifacts shape) and reused for the {@code GET /api/artifacts} list. {@code createdAt}
 * is an epoch-millis BIGINT column; {@code updatedAt} is a nullable epoch-millis column,
 * omitted from JSON when null (the task-detail query does not select it).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ArtifactSummary(
        String id,
        String type,
        String title,
        String language,
        int version,
        long createdAt,
        Long updatedAt) {
}
