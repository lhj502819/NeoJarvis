package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.RecordSessionRequest;
import com.jarvis.domain.SessionRow;
import com.jarvis.mapper.AgentSessionMapper;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

/** Unit tests for the session registry write side (port of TS recordAgentSession + matches). */
class SessionServiceTest {

    private AgentSessionMapper mapper;
    private SessionService service;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(AgentSessionMapper.class);
        service = new SessionService(mapper);
    }

    @Test
    void recordInsertsNewSessionWithExtractedKeywordTopics() {
        when(mapper.findByUserAndSession("u1", "s1")).thenReturn(Optional.empty());
        when(mapper.countByUser("u1")).thenReturn(1L);

        service.record("u1", new RecordSessionRequest("s1", "r1", "调研 openspec 的工具用法", "技术调研", "/repo"));

        ArgumentCaptor<String> topics = ArgumentCaptor.forClass(String.class);
        verify(mapper).insertSession(eq("u1"), eq("s1"), eq("r1"), eq("技术调研"), eq("/repo"),
                topics.capture(), eq("调研 openspec 的工具用法"), Mockito.anyString());
        // "调研" is a stop word -> dropped; openspec + 工具用法 survive
        assertThat(topics.getValue()).contains("openspec");
        verify(mapper, never()).deleteOldest(Mockito.anyString(), Mockito.anyInt());
    }

    @Test
    void recordTrimsToFiftyWhenOverCap() {
        when(mapper.findByUserAndSession("u1", "s1")).thenReturn(Optional.empty());
        when(mapper.countByUser("u1")).thenReturn(53L);

        service.record("u1", new RecordSessionRequest("s1", "r1", "hello world task", null, null));

        // null domain/cwd coalesced to "" (mirrors TS domain || '')
        verify(mapper).insertSession(eq("u1"), eq("s1"), eq("r1"), eq(""), eq(""),
                Mockito.anyString(), eq("hello world task"), Mockito.anyString());
        verify(mapper).deleteOldest("u1", 3);
    }

    @Test
    void recordMergesTopicsAndBumpsExistingSession() {
        when(mapper.findByUserAndSession("u1", "s1")).thenReturn(Optional.of(new SessionRow(
                "s1", "r1", "dev", "/tmp", "[\"openspec\"]", "old", "2026-07-01", 2)));

        service.record("u1", new RecordSessionRequest("s1", "r1", "more openspec plus feature", "dev", "/tmp"));

        ArgumentCaptor<String> merged = ArgumentCaptor.forClass(String.class);
        verify(mapper).updateExisting(eq("u1"), eq("s1"), merged.capture(),
                eq("more openspec plus feature"), Mockito.anyString(), eq("dev"), eq("/tmp"));
        // old topic kept first, new keywords appended (union), no duplicate openspec
        assertThat(merged.getValue()).startsWith("[\"openspec\"");
        assertThat(merged.getValue()).contains("feature");
        verify(mapper, never()).insertSession(Mockito.anyString(), Mockito.anyString(),
                Mockito.anyString(), Mockito.anyString(), Mockito.anyString(), Mockito.anyString(),
                Mockito.anyString(), Mockito.anyString());
    }

    @Test
    void byDomainAndByRecipeMapRowsToApiShape() {
        var row = new SessionRow("s1", "r1", null, null, "[\"x\"]", "d", "2026-07-14", 3);
        when(mapper.listByUserAndDomain("u1", "dev")).thenReturn(List.of(row));
        when(mapper.listByUserAndRecipe("u1", "r1")).thenReturn(List.of(row));

        assertThat(service.byDomain("u1", "dev").get(0).topics()).containsExactly("x");
        assertThat(service.byDomain("u1", "dev").get(0).domain()).isEmpty(); // null -> ""
        assertThat(service.byRecipe("u1", "r1").get(0).sessionId()).isEqualTo("s1");
    }

    @Test
    void extractKeywordsMirrorsTsRules() {
        // stop words dropped, <2 char dropped, capped at 10, punctuation split
        assertThat(SessionService.extractKeywords("调研 openspec，分析 report tool"))
                .containsExactly("openspec", "report", "tool");
        assertThat(SessionService.extractKeywords(null)).isEmpty();
        assertThat(SessionService.extractKeywords("。，！")).isEmpty();
    }
}
