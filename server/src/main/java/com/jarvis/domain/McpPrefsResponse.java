package com.jarvis.domain;

import java.util.List;

/**
 * Response for {@code GET /api/mcp/prefs}: MCP names the user has disabled (blacklist).
 * Mirrors {@link SkillPrefsResponse}; carries {@code code=0} to align with the TS client
 * shape {@code { code: number, disabled: string[] }} (client only destructures {@code disabled}).
 */
public record McpPrefsResponse(int code, List<String> disabled) {

    public static McpPrefsResponse of(List<String> disabled) {
        return new McpPrefsResponse(0, disabled);
    }
}
