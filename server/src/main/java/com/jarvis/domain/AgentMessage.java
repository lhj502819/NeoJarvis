package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/**
 * One A2A message in its API shape — field-for-field identical to the TS {@code A2AMessage}
 * interface ({@code id/from/to/contextId/role/parts/timestamp/metadata}). {@code parts} is an
 * arbitrary JSON array (A2APart objects) and {@code metadata} an optional JSON object; both are
 * echoed exactly as stored. {@code metadata} is omitted from JSON when null (mirrors the TS
 * optional {@code metadata?}).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AgentMessage(
        String id,
        String from,
        String to,
        String contextId,
        String role,
        List<Object> parts,
        String timestamp,
        Map<String, Object> metadata) {
}
