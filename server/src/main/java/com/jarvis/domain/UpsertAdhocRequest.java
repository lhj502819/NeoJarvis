package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/**
 * Body for {@code POST /api/adhoc} (ports the {@code upsertAdhocAgent} params in
 * src/a2a/adhoc.ts). The TS layer silently no-ops on an empty domain; the REST endpoint
 * instead rejects it up front ({@code @NotBlank}) since a domain-less upsert has nothing
 * to aggregate on. {@code topics} is optional and defaults to an empty list.
 */
public record UpsertAdhocRequest(
        @NotBlank String domain,
        @NotBlank String taskDescription,
        String cwd,
        String sessionId,
        List<String> topics) {
}
