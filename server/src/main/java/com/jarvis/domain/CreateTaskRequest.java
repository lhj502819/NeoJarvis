package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;

/**
 * Body for {@code POST /api/tasks} (mirrors TS createTask). Both fields required:
 * a task always carries a name and a description.
 */
public record CreateTaskRequest(
        @NotBlank String name,
        @NotBlank String description) {
}
