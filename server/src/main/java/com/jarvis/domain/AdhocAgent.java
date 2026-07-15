package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * API-shaped adhoc (temporary) agent aggregate (matches the TS {@code AdhocAgent} in
 * src/shared/types.ts). {@code topics} is a JSON array in the DB and {@code promoted} an
 * INT 0/1; the service parses the raw {@link AdhocAgentRow} into these typed fields.
 * {@code cwd}/{@code lastSessionId} are omitted from JSON when absent (mirrors TS
 * {@code undefined}).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdhocAgent(
        String id,
        String userId,
        String domain,
        int taskCount,
        String lastTaskDescription,
        String cwd,
        List<String> topics,
        String lastSessionId,
        boolean promoted,
        String createdAt,
        String updatedAt) {
}
