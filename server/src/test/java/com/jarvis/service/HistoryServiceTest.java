package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.jarvis.domain.AgentSession;
import com.jarvis.domain.SessionRow;
import com.jarvis.mapper.AgentSessionMapper;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class HistoryServiceTest {

    private AgentSessionMapper mapper;
    private HistoryService service;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(AgentSessionMapper.class);
        service = new HistoryService(mapper);
    }

    @Test
    void parsesTopicsAndCoalescesNullDomainCwd() {
        // Given: null domain/cwd and a JSON topics array
        when(mapper.listByUser("local")).thenReturn(List.of(new SessionRow(
                "sess-1", "r1", null, null, "[\"x\",\"y\"]", "did stuff", "2026-07-14", 4)));

        // When
        AgentSession s = service.listSessions("local").get(0);

        // Then: topics parsed, null -> "" (mirrors TS rowToSession)
        assertThat(s.topics()).containsExactly("x", "y");
        assertThat(s.domain()).isEmpty();
        assertThat(s.cwd()).isEmpty();
        assertThat(s.taskCount()).isEqualTo(4);
    }
}
