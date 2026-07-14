package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/**
 * Body for {@code POST /api/task/{taskId}/subtasks} (mirrors TS addSubTask params).
 * {@code name}/{@code description}/{@code assignee} required; {@code domain}/{@code cwd}/
 * {@code dependsOn} optional. {@code dependsOn} is a list of subtask ids this one waits on.
 */
public record AddSubTaskRequest(
        @NotBlank String name,
        @NotBlank String description,
        @NotBlank String assignee,
        String domain,
        String cwd,
        List<String> dependsOn) {
}
