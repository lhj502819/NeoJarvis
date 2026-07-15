package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/**
 * Decrypted MCP server view used by the intelligence layer to assemble the SDK
 * {@code mcpServers} dict. Field set matches the TS {@code ResolvedMcpServer} interface in
 * src/auth/mcp-servers.ts — it carries the PLAINTEXT {@code env} map. Only ever returned
 * from the internal resolve endpoint; never exposed on the public list/create/update views
 * (use the redacted {@link McpServer} for those).
 *
 * <p>{@code command}/{@code args}/{@code url}/{@code description} are omitted from JSON when
 * absent (mirrors TS {@code undefined}); {@code env} is always present (an empty {@code {}}
 * when the server has no env), matching the TS {@code Record<string, string>} default.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ResolvedMcpServer(
        String name,
        String transport,
        String command,
        List<String> args,
        String url,
        Map<String, String> env,
        String description) {
}
