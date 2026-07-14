package com.jarvis.web;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.AgentSession;
import com.jarvis.service.HistoryService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(HistoryController.class)
class HistoryControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private HistoryService historyService;

    @Test
    void historyReturnsSessionShape() throws Exception {
        when(historyService.listSessions("local")).thenReturn(List.of(new AgentSession(
                "sess-1", "r1", "dev", "/tmp", List.of("x", "y"), "did stuff", "2026-07-14", 4)));

        mockMvc.perform(get("/api/history"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].sessionId").value("sess-1"))
                .andExpect(jsonPath("$[0].topics[1]").value("y"))
                .andExpect(jsonPath("$[0].taskCount").value(4));
    }
}
