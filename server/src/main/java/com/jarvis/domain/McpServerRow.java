package com.jarvis.domain;

/**
 * Persistence view of a {@code jarvis_user_mcp_servers} row, including the encrypted
 * {@code envEnc} and raw {@code argsJson}. Internal only — never serialized to clients
 * (use the redacted {@link McpServer}). {@code enabled} is an INT 0/1.
 */
public record McpServerRow(
        String id,
        String userId,
        String name,
        String transport,
        String command,
        String argsJson,
        String url,
        String envEnc,
        String description,
        int enabled,
        String createdAt,
        String updatedAt) {
}
