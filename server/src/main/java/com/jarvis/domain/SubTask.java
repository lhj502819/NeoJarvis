package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * API-shaped subtask (matches TS {@code SubTask}). {@code agentType}/{@code agentName}
 * are computed by the service by joining {@code assignee} against the recipe table
 * (permanent = recipe hit, adhoc = miss). Null fields are omitted to mirror TS.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SubTask(
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
        List<String> dependsOn,
        String startedAt,
        Integer turnCount,
        Integer retryCount,
        Integer tokensInput,
        Integer tokensOutput,
        String createdAt,
        String updatedAt,
        String agentType,
        String agentName) {
}
