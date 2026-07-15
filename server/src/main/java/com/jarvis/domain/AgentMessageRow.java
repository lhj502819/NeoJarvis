package com.jarvis.domain;

/**
 * Raw {@code jarvis_agent_messages} row. {@code parts} and {@code metadata} are JSON-in-TEXT
 * (parsed by the service via {@link com.jarvis.util.Json}); {@code timestamp} is ISO-8601 TEXT
 * (a lexicographic sort on it is chronological, matching the old TS ORDER BY timestamp).
 */
public record AgentMessageRow(
        String id,
        String threadId,
        String sender,
        String receiver,
        String role,
        String parts,
        String timestamp,
        String metadata) {
}
