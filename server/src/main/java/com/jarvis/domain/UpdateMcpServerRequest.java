package com.jarvis.domain;

import java.util.List;
import java.util.Map;

/**
 * Body for {@code PUT /api/mcp-servers/{name}} (ports {@code updateMcpServer} in
 * src/auth/mcp-servers.ts). All fields optional — a null field keeps the stored value
 * (TS {@code ??} merge). {@code env}/{@code args} follow "present replaces, absent keeps":
 * a non-null value fully replaces the stored one (empty clears it to NULL), while null
 * leaves the existing ciphertext / JSON untouched.
 */
public record UpdateMcpServerRequest(
        String transport,
        String command,
        List<String> args,
        String url,
        Map<String, String> env,
        String description,
        Boolean enabled) {
}
