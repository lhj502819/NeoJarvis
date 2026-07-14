package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;

/** Body for {@code PATCH /api/subtask/{id}/started} (mirrors TS setSubtaskStarted). */
public record SetSubtaskStartedRequest(
        @NotBlank String startedAt) {
}
