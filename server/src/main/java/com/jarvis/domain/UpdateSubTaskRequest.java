package com.jarvis.domain;

/**
 * Body for {@code PATCH /api/subtask/{id}} (mirrors TS updateSubTask). All fields
 * optional — only the non-null ones are applied over the current subtask.
 */
public record UpdateSubTaskRequest(
        String status,
        String progress,
        String result,
        String error,
        String blockedReason) {
}
