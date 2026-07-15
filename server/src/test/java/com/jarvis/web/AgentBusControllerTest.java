package com.jarvis.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.AgentConversation;
import com.jarvis.domain.AgentMessage;
import com.jarvis.service.AgentBusService;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(AgentBusController.class)
class AgentBusControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private AgentBusService agentBusService;

    private static AgentMessage message(String id, String from, String to, Map<String, Object> meta) {
        return new AgentMessage(id, from, to, "ctx-1", "user",
                List.of(Map.of("kind", "text", "text", "hi")), "2026-07-14T00:00:00Z", meta);
    }

    @Test
    void recordReturnsOkAndForwardsMessage() throws Exception {
        mockMvc.perform(post("/api/agent-messages").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"id":"m1","from":"jarvis","to":"agent-a","contextId":"ctx-1",
                                 "role":"user","parts":[{"kind":"text","text":"hi"}],
                                 "timestamp":"2026-07-14T00:00:00Z"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));

        verify(agentBusService).record(eq("local"), any());
    }

    @Test
    void recordRejectsBlankRequiredFields() throws Exception {
        mockMvc.perform(post("/api/agent-messages").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\"\",\"from\":\"jarvis\",\"to\":\"a\",\"contextId\":\"c\","
                                + "\"role\":\"user\",\"parts\":[],\"timestamp\":\"t\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void threadReturnsConversationWithMessages() throws Exception {
        when(agentBusService.getConversation("ctx-1")).thenReturn(Optional.of(new AgentConversation(
                "ctx-1", List.of("jarvis", "agent-a"),
                List.of(message("m1", "jarvis", "agent-a", Map.of("type", "question"))),
                "c0", "u0")));

        mockMvc.perform(get("/api/agent-threads/ctx-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.contextId").value("ctx-1"))
                .andExpect(jsonPath("$.participants[1]").value("agent-a"))
                .andExpect(jsonPath("$.messages[0].id").value("m1"))
                .andExpect(jsonPath("$.messages[0].from").value("jarvis"))
                .andExpect(jsonPath("$.messages[0].to").value("agent-a"))
                .andExpect(jsonPath("$.messages[0].metadata.type").value("question"));
    }

    @Test
    void threadReturns404WhenMissing() throws Exception {
        when(agentBusService.getConversation("nope")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/agent-threads/nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("会话不存在"));
    }

    @Test
    void messagesForwardsLimitAndOmitsNullMetadata() throws Exception {
        when(agentBusService.getRecentMessages("ctx-1", 5))
                .thenReturn(List.of(message("m1", "jarvis", "agent-a", null)));

        mockMvc.perform(get("/api/agent-threads/ctx-1/messages?limit=5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("m1"))
                .andExpect(jsonPath("$[0].metadata").doesNotExist());
    }

    @Test
    void messagesDefaultsLimitWhenAbsent() throws Exception {
        when(agentBusService.getRecentMessages("ctx-1", null)).thenReturn(List.of());

        mockMvc.perform(get("/api/agent-threads/ctx-1/messages"))
                .andExpect(status().isOk());

        verify(agentBusService).getRecentMessages("ctx-1", null);
    }

    @Test
    void threadsListsAllWhenNoParticipant() throws Exception {
        when(agentBusService.getAllConversations()).thenReturn(List.of(new AgentConversation(
                "ctx-1", List.of("jarvis"), List.of(), "c0", "u0")));

        mockMvc.perform(get("/api/agent-threads"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].contextId").value("ctx-1"))
                .andExpect(jsonPath("$[0].messages").isEmpty());

        verify(agentBusService).getAllConversations();
    }

    @Test
    void threadsFiltersByParticipant() throws Exception {
        when(agentBusService.getAgentConversations("agent-a")).thenReturn(List.of(new AgentConversation(
                "ctx-1", List.of("jarvis", "agent-a"), List.of(), "c0", "u0")));

        mockMvc.perform(get("/api/agent-threads?participant=agent-a"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].contextId").value("ctx-1"));

        verify(agentBusService).getAgentConversations("agent-a");
    }
}
