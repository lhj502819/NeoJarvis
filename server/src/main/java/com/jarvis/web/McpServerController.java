package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.AddMcpServerRequest;
import com.jarvis.domain.McpServer;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.UpdateMcpServerRequest;
import com.jarvis.service.McpServerService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** User MCP server endpoints (ports src/auth/mcp-servers.ts). Env values are never returned. */
@RestController
@RequestMapping("/api/mcp-servers")
class McpServerController {

    private final McpServerService mcpServerService;

    McpServerController(McpServerService mcpServerService) {
        this.mcpServerService = mcpServerService;
    }

    /** GET /api/mcp-servers — redacted list (env exposed only as key names). */
    @GetMapping
    List<McpServer> list() {
        return mcpServerService.list(UserContext.currentUserId());
    }

    /** POST /api/mcp-servers — create; env encrypted before storage, returned redacted. */
    @PostMapping
    McpServer add(@Valid @RequestBody AddMcpServerRequest request) {
        return mcpServerService.add(UserContext.currentUserId(), request);
    }

    /** PUT /api/mcp-servers/{name} — update; 404 when the server is missing. */
    @PutMapping("/{name}")
    McpServer update(@PathVariable String name, @RequestBody UpdateMcpServerRequest request) {
        return mcpServerService.update(UserContext.currentUserId(), name, request)
                .orElseThrow(() -> new NotFoundException("MCP server 不存在"));
    }

    /** DELETE /api/mcp-servers/{name} — {@code {ok:true}}, 404 when missing. */
    @DeleteMapping("/{name}")
    OkResponse delete(@PathVariable String name) {
        if (!mcpServerService.remove(UserContext.currentUserId(), name)) {
            throw new NotFoundException("MCP server 不存在");
        }
        return new OkResponse(true);
    }
}
