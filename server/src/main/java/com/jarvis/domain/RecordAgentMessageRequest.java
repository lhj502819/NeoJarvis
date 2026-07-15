package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;

/**
 * POST body for {@code /api/agent-messages} — the A2A message the TS bus builds
 * ({@code buildMessage}). Field-for-field identical to the TS {@code A2AMessage}. {@code to}
 * may be {@code "*"} (broadcast). {@code metadata} is optional.
 */
public record RecordAgentMessageRequest(
        @NotBlank String id,
        @NotBlank String from,
        @NotBlank String to,
        @NotBlank String contextId,
        @NotBlank String role,
        @NotNull List<Object> parts,
        @NotBlank String timestamp,
        Map<String, Object> metadata) {
}
