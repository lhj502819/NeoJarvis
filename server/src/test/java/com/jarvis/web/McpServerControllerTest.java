package com.jarvis.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.AddMcpServerRequest;
import com.jarvis.domain.McpServer;
import com.jarvis.domain.ResolvedMcpServer;
import com.jarvis.domain.UpdateMcpServerRequest;
import com.jarvis.service.McpServerService;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(McpServerController.class)
class McpServerControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private McpServerService mcpServerService;

    private static McpServer sample() {
        return new McpServer("m1", "local", "fs", "stdio", "npx", List.of("-y", "fs"), null,
                List.of("API_KEY"), "desc", true, "2026-07-10T00:00:00Z", "2026-07-14T00:00:00Z");
    }

    @Test
    void listExposesKeyNamesNotEnvValues() throws Exception {
        when(mcpServerService.list("local")).thenReturn(List.of(sample()));

        mockMvc.perform(get("/api/mcp-servers"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("fs"))
                .andExpect(jsonPath("$[0].envKeys[0]").value("API_KEY"))
                .andExpect(jsonPath("$[0].enabled").value(true))
                .andExpect(jsonPath("$[0].env").doesNotExist())
                .andExpect(jsonPath("$[0].envEnc").doesNotExist());
    }

    @Test
    void resolvedReturnsDecryptedEnv() throws Exception {
        when(mcpServerService.resolve("local")).thenReturn(List.of(new ResolvedMcpServer(
                "fs", "stdio", "npx", List.of("-y", "fs"), null, Map.of("API_KEY", "sk-plain"),
                "desc")));

        mockMvc.perform(get("/api/mcp-servers/resolved"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("fs"))
                .andExpect(jsonPath("$[0].env.API_KEY").value("sk-plain"))
                .andExpect(jsonPath("$[0].envKeys").doesNotExist());
    }

    @Test
    void resolvedReturnsEmptyArrayWhenNoneEnabled() throws Exception {
        when(mcpServerService.resolve("local")).thenReturn(List.of());

        mockMvc.perform(get("/api/mcp-servers/resolved"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$").isEmpty());
    }

    @Test
    void addReturnsRedactedServer() throws Exception {
        when(mcpServerService.add(eq("local"), any(AddMcpServerRequest.class)))
                .thenReturn(sample());

        mockMvc.perform(post("/api/mcp-servers").contentType("application/json").content("""
                {"name":"fs","transport":"stdio","command":"npx","env":{"API_KEY":"sk-x"}}
                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.envKeys[0]").value("API_KEY"))
                .andExpect(jsonPath("$.env").doesNotExist());
    }

    @Test
    void addRejectsMissingName() throws Exception {
        mockMvc.perform(post("/api/mcp-servers").contentType("application/json")
                        .content("{\"transport\":\"stdio\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void updateReturns404WhenMissing() throws Exception {
        when(mcpServerService.update(eq("local"), eq("nope"), any(UpdateMcpServerRequest.class)))
                .thenReturn(Optional.empty());

        mockMvc.perform(put("/api/mcp-servers/nope").contentType("application/json").content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("MCP server 不存在"));
    }

    @Test
    void deleteReturnsOkOr404() throws Exception {
        when(mcpServerService.remove("local", "fs")).thenReturn(true);
        mockMvc.perform(delete("/api/mcp-servers/fs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));

        when(mcpServerService.remove("local", "gone")).thenReturn(false);
        mockMvc.perform(delete("/api/mcp-servers/gone"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("MCP server 不存在"));
    }
}
