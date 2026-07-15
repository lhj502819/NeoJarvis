package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * Redacted MCP server view (matches the TS {@code McpServer} in src/auth/mcp-servers.ts).
 * The stored {@code env} is NEVER returned in full — only {@code envKeys} (the key names)
 * leaves the service so secrets stay in the DB. {@code command}/{@code args}/{@code url}/
 * {@code description} are omitted from JSON when absent (mirrors TS {@code undefined});
 * {@code envKeys} is always present (empty list when there is no env).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record McpServer(
        String id,
        String userId,
        String name,
        String transport,
        String command,
        List<String> args,
        String url,
        List<String> envKeys,
        String description,
        boolean enabled,
        String createdAt,
        String updatedAt) {
}
