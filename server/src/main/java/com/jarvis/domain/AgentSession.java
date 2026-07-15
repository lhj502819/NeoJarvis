package com.jarvis.domain;

import com.jarvis.util.Json;
import java.util.List;

/**
 * API-shaped agent session (matches TS {@code AgentSession} in src/a2a/history.ts).
 * {@code topics} is a JSON array in the DB; {@link #from(SessionRow)} parses it and coalesces
 * null domain/cwd to empty string (mirrors the TS {@code rowToSession}).
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

    /** Map a persistence row to the API shape (topics parsed, null domain/cwd -> ""). */
    public static AgentSession from(SessionRow r) {
        return new AgentSession(
                r.sessionId(), r.recipeId(),
                r.domain() != null ? r.domain() : "",
                r.cwd() != null ? r.cwd() : "",
                Json.stringList(r.topics()), r.lastTaskDescription(),
                r.completedAt(), r.taskCount());
    }
}
