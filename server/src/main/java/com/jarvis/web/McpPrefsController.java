package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.McpPrefsResponse;
import com.jarvis.domain.McpToggleRequest;
import com.jarvis.domain.OkResponse;
import com.jarvis.service.McpPrefsService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * MCP enable/disable preferences (blacklist). Sibling of {@link SkillController}; owns the
 * {@code /api/mcp/*} prefix which is distinct from the {@code /api/mcp-servers} CRUD (that
 * targets the {@code jarvis_user_mcp_servers} table, a different concern).
 */
@RestController
@RequestMapping("/api/mcp")
class McpPrefsController {

    private final McpPrefsService mcpPrefsService;

    McpPrefsController(McpPrefsService mcpPrefsService) {
        this.mcpPrefsService = mcpPrefsService;
    }

    /** GET /api/mcp/prefs — {@code { code: 0, disabled: [...] }} (user's disabled MCP names). */
    @GetMapping("/prefs")
    McpPrefsResponse prefs() {
        return mcpPrefsService.getDisabled(UserContext.currentUserId());
    }

    /** POST /api/mcp/{name}/toggle — enable/disable an MCP, returns {@code {ok:true}}. */
    @PostMapping("/{name}/toggle")
    OkResponse toggle(@PathVariable String name, @Valid @RequestBody McpToggleRequest request) {
        mcpPrefsService.setEnabled(UserContext.currentUserId(), name, request.enabled());
        return new OkResponse(true);
    }
}
