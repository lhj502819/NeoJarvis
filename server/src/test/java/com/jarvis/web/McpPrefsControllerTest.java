package com.jarvis.web;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.McpPrefsResponse;
import com.jarvis.service.McpPrefsService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(McpPrefsController.class)
class McpPrefsControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private McpPrefsService mcpPrefsService;

    @Test
    void prefsReturnsDisabledListWithCodeZero() throws Exception {
        when(mcpPrefsService.getDisabled("local"))
                .thenReturn(McpPrefsResponse.of(List.of("chrome-devtools")));

        mockMvc.perform(get("/api/mcp/prefs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.disabled[0]").value("chrome-devtools"));
    }

    @Test
    void toggleAppliesEnabledFlagAndReturnsOk() throws Exception {
        mockMvc.perform(post("/api/mcp/chrome-devtools/toggle")
                        .contentType("application/json").content("{\"enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));

        verify(mcpPrefsService).setEnabled("local", "chrome-devtools", false);
    }

    @Test
    void toggleRejectsMissingEnabledFlag() throws Exception {
        mockMvc.perform(post("/api/mcp/chrome-devtools/toggle")
                        .contentType("application/json").content("{}"))
                .andExpect(status().isBadRequest());
    }
}
