package com.jarvis.web;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.AgentSession;
import com.jarvis.domain.RecordSessionRequest;
import com.jarvis.service.SessionService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(SessionController.class)
class SessionControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private SessionService sessionService;

    @Test
    void recordForwardsBodyToService() throws Exception {
        mockMvc.perform(post("/api/sessions").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":\"s1\",\"recipeId\":\"r1\",\"description\":\"do it\",\"domain\":\"dev\"}"))
                .andExpect(status().isOk());

        verify(sessionService).record(eq("local"),
                eq(new RecordSessionRequest("s1", "r1", "do it", "dev", null)));
    }

    @Test
    void recordRejectsMissingSessionId() throws Exception {
        mockMvc.perform(post("/api/sessions").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"recipeId\":\"r1\",\"description\":\"do it\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void byDomainReturnsSessions() throws Exception {
        when(sessionService.byDomain("local", "dev")).thenReturn(List.of(new AgentSession(
                "s1", "r1", "dev", "/tmp", List.of("x"), "d", "2026-07-14", 2)));

        mockMvc.perform(get("/api/sessions/by-domain?domain=dev"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].sessionId").value("s1"))
                .andExpect(jsonPath("$[0].topics[0]").value("x"));
    }

    @Test
    void matchReturnsRecipeSessions() throws Exception {
        when(sessionService.byRecipe("local", "r1")).thenReturn(List.of(new AgentSession(
                "s1", "r1", "dev", "/tmp", List.of("y"), "d", "2026-07-14", 2)));

        mockMvc.perform(get("/api/sessions/match?recipeId=r1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].recipeId").value("r1"));
    }
}
