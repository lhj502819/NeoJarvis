package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;

/**
 * Body for {@code POST /api/sessions} (ports src/a2a/history.ts recordAgentSession). The server
 * extracts keywords from {@code description} for the {@code topics} column, so the client sends
 * the raw description rather than a pre-tokenised list. {@code domain}/{@code cwd} are optional
 * (null coalesced to "" server-side, matching the TS {@code domain || ''}).
 */
public record RecordSessionRequest(
        @NotBlank String sessionId,
        @NotBlank String recipeId,
        String description,
        String domain,
        String cwd) {
}
