package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;

/**
 * Body for {@code POST /api/mcp-servers} (ports {@code addMcpServer} in
 * src/auth/mcp-servers.ts). {@code name}/{@code transport} are required; the transport
 * rule (stdio needs {@code command}; sse/http need {@code url}) is enforced in the
 * service. {@code env} is encrypted before storage and never echoed back.
 */
public record AddMcpServerRequest(
        @NotBlank String name,
        @NotBlank String transport,
        String command,
        List<String> args,
        String url,
        Map<String, String> env,
        String description) {
}
