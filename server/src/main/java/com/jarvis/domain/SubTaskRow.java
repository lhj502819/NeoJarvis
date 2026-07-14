package com.jarvis.domain;

/**
 * Persistence view of a row in {@code jarvis_subtasks}. {@code dependsOn} is the
 * raw JSON TEXT column (parsed to a list by the service). The extra {@code user_id}
 * column is ignored by MyBatis auto-mapping.
 */
public record SubTaskRow(
        String id,
        String taskId,
        String name,
        String description,
        String assignee,
        String domain,
        String cwd,
        String status,
        String progress,
        String result,
        String error,
        String blockedReason,
        String dependsOn,
        String startedAt,
        Integer turnCount,
        Integer retryCount,
        Integer tokensInput,
        Integer tokensOutput,
        String createdAt,
        String updatedAt) {
}
