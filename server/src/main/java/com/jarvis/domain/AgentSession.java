package com.jarvis.domain;

import java.util.List;

/**
 * API-shaped agent session (matches TS {@code AgentSession} in src/a2a/history.ts).
 * {@code topics} is a JSON array in the DB; the service parses it from {@link SessionRow}.
 */
public record AgentSession(
        String sessionId,
        String recipeId,
        String domain,
        String cwd,
        List<String> topics,
        String lastTaskDescription,
        String completedAt,
        int taskCount) {
}
