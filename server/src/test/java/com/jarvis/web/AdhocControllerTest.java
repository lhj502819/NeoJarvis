package com.jarvis.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.AdhocAgent;
import com.jarvis.domain.UpsertAdhocRequest;
import com.jarvis.service.AdhocService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(AdhocController.class)
class AdhocControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private AdhocService adhocService;

    private static AdhocAgent sample() {
        return new AdhocAgent("a1", "local", "code", 3, "write parser", "/w", List.of("java"),
                null, false, "2026-07-10T00:00:00Z", "2026-07-14T00:00:00Z");
    }

    @Test
    void listReturnsAgents() throws Exception {
        when(adhocService.list("local")).thenReturn(List.of(sample()));

        mockMvc.perform(get("/api/adhoc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].domain").value("code"))
                .andExpect(jsonPath("$[0].topics[0]").value("java"))
                .andExpect(jsonPath("$[0].lastSessionId").doesNotExist());
    }

    @Test
    void getReturns404WhenMissing() throws Exception {
        when(adhocService.get("local", "gone")).thenReturn(Optional.empty());
        mockMvc.perform(get("/api/adhoc/gone"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("adhoc agent 不存在"));
    }

    @Test
    void upsertReturnsAggregate() throws Exception {
        when(adhocService.upsert(eq("local"), any(UpsertAdhocRequest.class))).thenReturn(sample());

        mockMvc.perform(post("/api/adhoc").contentType("application/json").content("""
                {"domain":"code","taskDescription":"write parser","topics":["java"]}
                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.taskCount").value(3));
    }

    @Test
    void upsertRejectsMissingDomain() throws Exception {
        mockMvc.perform(post("/api/adhoc").contentType("application/json")
                        .content("{\"taskDescription\":\"x\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void markPromotedReturnsOk() throws Exception {
        mockMvc.perform(post("/api/adhoc/code/promoted"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
        verify(adhocService).markPromoted("local", "code");
    }
}
