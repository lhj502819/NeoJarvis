package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.AgentMessageRow;
import com.jarvis.domain.AgentThreadRow;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

@MybatisTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Sql(scripts = "classpath:schema.sql")
class AgentBusMapperTest {

    @Autowired
    private AgentBusMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        // thread(id, participants, created_at, updated_at)
        insertThread("ctx-1", "[\"jarvis\",\"agent-a\"]", "2026-07-01T00:00:00Z", "2026-07-03T00:00:00Z");
        insertThread("ctx-2", "[\"jarvis\",\"agent-b\"]", "2026-07-02T00:00:00Z", "2026-07-01T00:00:00Z");
        // messages under ctx-1, out of insert order to prove ORDER BY timestamp
        insertMessage("m2", "ctx-1", "agent-a", "jarvis", "agent",
                "[{\"kind\":\"text\",\"text\":\"second\"}]", "2026-07-01T00:00:02Z", null);
        insertMessage("m1", "ctx-1", "jarvis", "agent-a", "user",
                "[{\"kind\":\"text\",\"text\":\"first\"}]", "2026-07-01T00:00:01Z", "{\"type\":\"question\"}");
    }

    @Test
    void findThreadReturnsRowOrEmpty() {
        AgentThreadRow row = mapper.findThread("ctx-1").orElseThrow();
        assertThat(row.participants()).isEqualTo("[\"jarvis\",\"agent-a\"]");
        assertThat(row.createdAt()).isEqualTo("2026-07-01T00:00:00Z");
        assertThat(mapper.findThread("nope")).isEmpty();
    }

    @Test
    void listMessagesAscOrdersByTimestamp() {
        var msgs = mapper.listMessagesAsc("ctx-1");
        assertThat(msgs).extracting(AgentMessageRow::id).containsExactly("m1", "m2");
        assertThat(msgs.get(0).sender()).isEqualTo("jarvis");
        assertThat(msgs.get(0).metadata()).isEqualTo("{\"type\":\"question\"}");
        assertThat(msgs.get(1).metadata()).isNull();
    }

    @Test
    void listRecentMessagesReturnsNewestFirstHonouringLimit() {
        var msgs = mapper.listRecentMessages("ctx-1", 1);
        assertThat(msgs).extracting(AgentMessageRow::id).containsExactly("m2"); // newest
    }

    @Test
    void findThreadsByParticipantMatchesJsonMember() {
        assertThat(mapper.findThreadsByParticipant("%\"agent-a\"%"))
                .extracting(AgentThreadRow::id).containsExactly("ctx-1");
        assertThat(mapper.findThreadsByParticipant("%\"jarvis\"%"))
                .extracting(AgentThreadRow::id).containsExactlyInAnyOrder("ctx-1", "ctx-2");
    }

    @Test
    void listThreadsOrdersByUpdatedAtDescAndCaps() {
        // ctx-1 updated 07-03 (newer) before ctx-2 updated 07-01
        assertThat(mapper.listThreads(10)).extracting(AgentThreadRow::id)
                .containsExactly("ctx-1", "ctx-2");
        assertThat(mapper.listThreads(1)).extracting(AgentThreadRow::id).containsExactly("ctx-1");
    }

    @Test
    void insertUpdateTouchThread() {
        mapper.insertThread("ctx-3", "system", "[\"jarvis\"]", "2026-07-05T00:00:00Z",
                "2026-07-05T00:00:00Z");
        assertThat(mapper.findThread("ctx-3")).isPresent();

        mapper.updateThreadParticipants("ctx-3", "[\"jarvis\",\"x\"]", "2026-07-06T00:00:00Z");
        var updated = mapper.findThread("ctx-3").orElseThrow();
        assertThat(updated.participants()).isEqualTo("[\"jarvis\",\"x\"]");
        assertThat(updated.updatedAt()).isEqualTo("2026-07-06T00:00:00Z");

        mapper.touchThread("ctx-3", "2026-07-07T00:00:00Z");
        assertThat(mapper.findThread("ctx-3").orElseThrow().updatedAt())
                .isEqualTo("2026-07-07T00:00:00Z");
    }

    @Test
    void insertMessageStoresPartsAndMetadata() {
        mapper.insertMessage("m3", "ctx-1", "jarvis", "*", "user",
                "[{\"kind\":\"text\",\"text\":\"bcast\"}]", "2026-07-01T00:00:03Z", null);
        var msgs = mapper.listMessagesAsc("ctx-1");
        assertThat(msgs).extracting(AgentMessageRow::id).containsExactly("m1", "m2", "m3");
        assertThat(msgs.get(2).receiver()).isEqualTo("*");
    }

    @Test
    void countAndDeleteOldestCascadesMessages() {
        assertThat(mapper.countThreads()).isEqualTo(2);
        // ctx-2 has the oldest updated_at (07-01) -> deleted first
        mapper.deleteOldest(1);
        assertThat(mapper.countThreads()).isEqualTo(1);
        assertThat(mapper.findThread("ctx-2")).isEmpty();
        assertThat(mapper.findThread("ctx-1")).isPresent();

        // deleting ctx-1 must cascade its messages (FK ON DELETE CASCADE)
        mapper.deleteOldest(1);
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM jarvis_agent_messages WHERE thread_id = 'ctx-1'", Integer.class))
                .isZero();
    }

    private void insertThread(String id, String participants, String createdAt, String updatedAt) {
        jdbc.update("INSERT INTO jarvis_agent_threads (id, user_id, participants, created_at, updated_at) "
                + "VALUES (?, 'system', ?, ?, ?)", id, participants, createdAt, updatedAt);
    }

    private void insertMessage(String id, String threadId, String sender, String receiver,
            String role, String parts, String timestamp, String metadata) {
        jdbc.update("INSERT INTO jarvis_agent_messages "
                + "(id, thread_id, sender, receiver, role, parts, `timestamp`, metadata) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                id, threadId, sender, receiver, role, parts, timestamp, metadata);
    }
}
