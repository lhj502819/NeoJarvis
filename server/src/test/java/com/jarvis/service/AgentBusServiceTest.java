package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.AgentMessage;
import com.jarvis.domain.AgentMessageRow;
import com.jarvis.domain.AgentThreadRow;
import com.jarvis.domain.RecordAgentMessageRequest;
import com.jarvis.mapper.AgentBusMapper;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

/** Unit tests for the message-bus write/read logic (port of TS recordMessage + history reads). */
class AgentBusServiceTest {

    private AgentBusMapper mapper;
    private AgentBusService service;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(AgentBusMapper.class);
        service = new AgentBusService(mapper);
    }

    private static RecordAgentMessageRequest msg(String id, String from, String to, String ctx,
            String role, List<Object> parts, Map<String, Object> metadata) {
        return new RecordAgentMessageRequest(id, from, to, ctx, role, parts, "2026-07-14T00:00:00Z", metadata);
    }

    private static List<Object> textParts(String text) {
        // LinkedHashMap keeps kind→text order so the serialised JSON is deterministic.
        Map<String, Object> part = new LinkedHashMap<>();
        part.put("kind", "text");
        part.put("text", text);
        return List.of(part);
    }

    @Test
    void recordInsertsNewThreadWithBothParticipants() {
        when(mapper.findThread("ctx-1")).thenReturn(Optional.empty());
        when(mapper.countThreads()).thenReturn(1L);

        service.record("system", msg("m1", "jarvis", "agent-a", "ctx-1", "user", textParts("hi"), null));

        ArgumentCaptor<String> participants = ArgumentCaptor.forClass(String.class);
        verify(mapper).insertThread(eq("ctx-1"), eq("system"), participants.capture(),
                eq("2026-07-14T00:00:00Z"), eq("2026-07-14T00:00:00Z"));
        assertThat(participants.getValue()).isEqualTo("[\"jarvis\",\"agent-a\"]");
        // message stored with parts serialised, metadata NULL
        verify(mapper).insertMessage(eq("m1"), eq("ctx-1"), eq("jarvis"), eq("agent-a"), eq("user"),
                eq("[{\"kind\":\"text\",\"text\":\"hi\"}]"), eq("2026-07-14T00:00:00Z"), eq(null));
        verify(mapper, never()).deleteOldest(Mockito.anyInt());
    }

    @Test
    void recordBroadcastThreadOmitsStarParticipant() {
        when(mapper.findThread("ctx-b")).thenReturn(Optional.empty());
        when(mapper.countThreads()).thenReturn(1L);

        service.record("system", msg("mb", "jarvis", "*", "ctx-b", "user", textParts("all"), null));

        ArgumentCaptor<String> participants = ArgumentCaptor.forClass(String.class);
        verify(mapper).insertThread(eq("ctx-b"), eq("system"), participants.capture(),
                Mockito.anyString(), Mockito.anyString());
        assertThat(participants.getValue()).isEqualTo("[\"jarvis\"]"); // "*" not added
    }

    @Test
    void recordUnionsParticipantsOnExistingThread() {
        when(mapper.findThread("ctx-1")).thenReturn(Optional.of(
                new AgentThreadRow("ctx-1", "system", "[\"jarvis\"]", "t0", "t0")));
        when(mapper.countThreads()).thenReturn(1L);

        service.record("system", msg("m2", "agent-a", "jarvis", "ctx-1", "agent", textParts("reply"), null));

        // "agent-a" is new -> participants updated + updated_at bumped; touch not used
        verify(mapper).updateThreadParticipants(eq("ctx-1"), eq("[\"jarvis\",\"agent-a\"]"),
                eq("2026-07-14T00:00:00Z"));
        verify(mapper, never()).touchThread(Mockito.anyString(), Mockito.anyString());
    }

    @Test
    void recordTouchesThreadWhenParticipantsUnchanged() {
        when(mapper.findThread("ctx-1")).thenReturn(Optional.of(
                new AgentThreadRow("ctx-1", "system", "[\"jarvis\",\"agent-a\"]", "t0", "t0")));
        when(mapper.countThreads()).thenReturn(1L);

        service.record("system", msg("m3", "jarvis", "agent-a", "ctx-1", "user", textParts("again"), null));

        verify(mapper).touchThread(eq("ctx-1"), eq("2026-07-14T00:00:00Z"));
        verify(mapper, never()).updateThreadParticipants(Mockito.anyString(), Mockito.anyString(),
                Mockito.anyString());
    }

    @Test
    void recordSerialisesMetadataAndTrimsOverCap() {
        when(mapper.findThread("ctx-1")).thenReturn(Optional.empty());
        when(mapper.countThreads()).thenReturn(103L);

        service.record("system",
                msg("m4", "agent-a", "jarvis", "ctx-1", "agent", textParts("q"), Map.of("type", "question")));

        verify(mapper).insertMessage(eq("m4"), eq("ctx-1"), eq("agent-a"), eq("jarvis"), eq("agent"),
                Mockito.anyString(), Mockito.anyString(), eq("{\"type\":\"question\"}"));
        verify(mapper).deleteOldest(3); // 103 - 100
    }

    @Test
    void getConversationMapsRowsToApiShape() {
        when(mapper.findThread("ctx-1")).thenReturn(Optional.of(
                new AgentThreadRow("ctx-1", "system", "[\"jarvis\",\"agent-a\"]", "c0", "u0")));
        when(mapper.listMessagesAsc("ctx-1")).thenReturn(List.of(
                new AgentMessageRow("m1", "ctx-1", "jarvis", "agent-a", "user",
                        "[{\"kind\":\"text\",\"text\":\"hi\"}]", "t1", "{\"type\":\"question\"}"),
                new AgentMessageRow("m2", "ctx-1", "agent-a", "jarvis", "agent",
                        "[{\"kind\":\"text\",\"text\":\"yo\"}]", "t2", null)));

        var conv = service.getConversation("ctx-1").orElseThrow();
        assertThat(conv.contextId()).isEqualTo("ctx-1");
        assertThat(conv.participants()).containsExactly("jarvis", "agent-a");
        assertThat(conv.messages()).extracting(AgentMessage::id).containsExactly("m1", "m2");
        // A2AMessage shape: sender->from, receiver->to, thread_id->contextId
        assertThat(conv.messages().get(0).from()).isEqualTo("jarvis");
        assertThat(conv.messages().get(0).to()).isEqualTo("agent-a");
        assertThat(conv.messages().get(0).contextId()).isEqualTo("ctx-1");
        assertThat(conv.messages().get(0).metadata()).containsEntry("type", "question");
        assertThat(conv.messages().get(1).metadata()).isNull(); // omitted when column NULL
    }

    @Test
    void getConversationEmptyWhenThreadMissing() {
        when(mapper.findThread("nope")).thenReturn(Optional.empty());
        assertThat(service.getConversation("nope")).isEmpty();
    }

    @Test
    void getRecentMessagesReversesToAscendingAndDefaultsLimit() {
        // mapper returns DESC (newest first); service reverses to ASC
        when(mapper.listRecentMessages("ctx-1", 20)).thenReturn(List.of(
                new AgentMessageRow("m2", "ctx-1", "agent-a", "jarvis", "agent", "[]", "t2", null),
                new AgentMessageRow("m1", "ctx-1", "jarvis", "agent-a", "user", "[]", "t1", null)));

        var msgs = service.getRecentMessages("ctx-1", null); // null -> default 20
        assertThat(msgs).extracting(AgentMessage::id).containsExactly("m1", "m2");
    }

    @Test
    void getAllConversationsReturnsEmptyMessages() {
        when(mapper.listThreads(100)).thenReturn(List.of(
                new AgentThreadRow("ctx-1", "system", "[\"jarvis\"]", "c0", "u0")));

        var all = service.getAllConversations();
        assertThat(all).hasSize(1);
        assertThat(all.get(0).messages()).isEmpty();
        assertThat(all.get(0).participants()).containsExactly("jarvis");
    }

    @Test
    void getAgentConversationsFiltersByParticipantPattern() {
        when(mapper.findThreadsByParticipant("%\"agent-a\"%")).thenReturn(List.of(
                new AgentThreadRow("ctx-1", "system", "[\"jarvis\",\"agent-a\"]", "c0", "u0")));
        when(mapper.findThread("ctx-1")).thenReturn(Optional.of(
                new AgentThreadRow("ctx-1", "system", "[\"jarvis\",\"agent-a\"]", "c0", "u0")));
        when(mapper.listMessagesAsc("ctx-1")).thenReturn(List.of());

        var convs = service.getAgentConversations("agent-a");
        assertThat(convs).extracting(c -> c.contextId()).containsExactly("ctx-1");
    }
}
