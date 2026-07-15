package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.AdhocAgent;
import com.jarvis.domain.AdhocAgentRow;
import com.jarvis.domain.UpsertAdhocRequest;
import com.jarvis.mapper.AdhocMapper;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class AdhocServiceTest {

    private AdhocMapper mapper;
    private AdhocService service;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(AdhocMapper.class);
        service = new AdhocService(mapper);
    }

    private static AdhocAgentRow row(String domain, int count, String topics, int promoted,
            String cwd, String session) {
        return new AdhocAgentRow("a1", "local", domain, count, "desc", cwd, topics, session,
                promoted, "2026-07-10T00:00:00Z", "2026-07-14T00:00:00Z");
    }

    @Test
    void upsertOnNewDomainInsertsFreshAggregateWithGeneratedId() {
        when(mapper.findByUserAndDomain("local", "code")).thenReturn(Optional.empty())
                .thenReturn(Optional.of(row("code", 1, "[\"java\"]", 0, "/w", null)));

        AdhocAgent result = service.upsert("local", new UpsertAdhocRequest(
                "code", "write a parser", "/w", null, List.of("java")));

        var id = ArgumentCaptor.forClass(String.class);
        var topics = ArgumentCaptor.forClass(String.class);
        verify(mapper).upsert(id.capture(), eq("local"), eq("code"), eq("write a parser"),
                eq("/w"), topics.capture(), eq(null), anyString());
        assertThat(id.getValue()).startsWith("adhoc-");
        assertThat(topics.getValue()).isEqualTo("[\"java\"]");
        assertThat(result.taskCount()).isEqualTo(1);
    }

    @Test
    void upsertOnExistingDomainMergesTopicsDedupedAndReusesIdAndCwd() {
        when(mapper.findByUserAndDomain("local", "code"))
                .thenReturn(Optional.of(row("code", 5, "[\"java\",\"maven\"]", 0, "/old", "sess")))
                .thenReturn(Optional.of(row("code", 6, "[\"java\",\"maven\",\"tests\"]", 0, "/old",
                        "sess")));

        service.upsert("local", new UpsertAdhocRequest(
                "code", "add tests", "/ignored", null, List.of("java", "tests")));

        var topics = ArgumentCaptor.forClass(String.class);
        // reuses stored id "a1" and stored cwd "/old" (new cwd ignored on update)
        verify(mapper).upsert(eq("a1"), eq("local"), eq("code"), eq("add tests"),
                eq("/old"), topics.capture(), eq(null), anyString());
        // existing ∪ new, de-duped, insertion order preserved
        assertThat(topics.getValue()).isEqualTo("[\"java\",\"maven\",\"tests\"]");
    }

    @Test
    void upsertOnPromotedDomainIsNoOp() {
        when(mapper.findByUserAndDomain("local", "code"))
                .thenReturn(Optional.of(row("code", 5, "[]", 1, null, null)));

        AdhocAgent result = service.upsert("local", new UpsertAdhocRequest(
                "code", "another task", null, null, List.of("x")));

        assertThat(result.promoted()).isTrue();
        verify(mapper, never()).upsert(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void upsertStripsAutoFallbackSessionIdToNull() {
        when(mapper.findByUserAndDomain("local", "code")).thenReturn(Optional.empty())
                .thenReturn(Optional.of(row("code", 1, "[]", 0, null, null)));

        service.upsert("local", new UpsertAdhocRequest(
                "code", "t", null, "auto-12345", List.of()));

        // auto- prefixed ids never resume -> stored as NULL
        verify(mapper).upsert(anyString(), eq("local"), eq("code"), eq("t"), eq(null),
                eq("[]"), eq(null), anyString());
    }

    @Test
    void listMapsRowsToAgents() {
        when(mapper.listActiveByUser("local"))
                .thenReturn(List.of(row("code", 9, "[\"java\"]", 0, null, null)));
        assertThat(service.list("local")).singleElement()
                .satisfies(a -> assertThat(a.topics()).containsExactly("java"));
    }

    @Test
    void markPromotedDelegates() {
        service.markPromoted("local", "code");
        verify(mapper).markPromoted("local", "code");
    }
}
