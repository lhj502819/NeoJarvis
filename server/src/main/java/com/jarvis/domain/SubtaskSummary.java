package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Lightweight subtask row for {@code /api/recipe/{id}/subtasks} (matches the TS
 * {@code listSubtasksByAssignee} return shape). Maps directly to the selected columns;
 * {@code domain}/{@code turnCount} are omitted when null (mirrors TS).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SubtaskSummary(
        String id,
        String taskId,
        String name,
        String description,
        String status,
        String domain,
        Integer turnCount,
        String createdAt) {
}
