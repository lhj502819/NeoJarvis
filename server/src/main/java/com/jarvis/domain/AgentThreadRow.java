package com.jarvis.domain;

/**
 * Raw {@code jarvis_agent_threads} row. {@code participants} is JSON-in-TEXT (parsed by the
 * service via {@link com.jarvis.util.Json}); {@code createdAt}/{@code updatedAt} are ISO-8601
 * TEXT (written straight from the A2A message timestamp, never re-derived).
 */
public record AgentThreadRow(
        String id,
        String userId,
        String participants,
        String createdAt,
        String updatedAt) {
}
