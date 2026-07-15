package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.AdhocAgentRow;
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
class AdhocMapperTest {

    @Autowired
    private AdhocMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        // busiest first ordering + promoted filtering fixtures
        insert("a1", "u1", "email", 5, "[\"inbox\"]", 0, "2026-07-10T00:00:00Z");
        insert("a2", "u1", "code", 9, "[\"java\"]", 0, "2026-07-11T00:00:00Z");
        insert("a3", "u1", "done", 3, "[]", 1, "2026-07-12T00:00:00Z");
        insert("a4", "u2", "other", 1, "[]", 0, "2026-07-12T00:00:00Z");
    }

    @Test
    void listActiveByUserExcludesPromotedAndOrdersByTaskCountDesc() {
        var rows = mapper.listActiveByUser("u1");
        // a3 promoted -> filtered; a2(9) before a1(5); scoped to u1
        assertThat(rows).extracting(AdhocAgentRow::domain).containsExactly("code", "email");
    }

    @Test
    void findByUserAndDomainScopesAndCarriesRawColumns() {
        var row = mapper.findByUserAndDomain("u1", "email");
        assertThat(row).isPresent();
        assertThat(row.get().taskCount()).isEqualTo(5);
        assertThat(row.get().topics()).isEqualTo("[\"inbox\"]");
        assertThat(row.get().promoted()).isZero();
        assertThat(mapper.findByUserAndDomain("u2", "email")).isEmpty();
    }

    @Test
    void upsertInsertsNewDomainWithTaskCountOne() {
        mapper.upsert("new-id", "u1", "design", "draft a logo", "/tmp",
                "[\"ui\"]", "sess-1", "2026-07-13T00:00:00Z");

        var row = mapper.findByUserAndDomain("u1", "design").orElseThrow();
        assertThat(row.id()).isEqualTo("new-id");
        assertThat(row.taskCount()).isEqualTo(1);
        assertThat(row.cwd()).isEqualTo("/tmp");
        assertThat(row.lastSessionId()).isEqualTo("sess-1");
        assertThat(row.promoted()).isZero();
    }

    @Test
    void upsertOnExistingDomainBumpsCountAndRefreshesFieldsKeepingCwd() {
        // existing a1 (email, count 5, cwd null). Upsert with a different id + no session.
        mapper.upsert("ignored-id", "u1", "email", "reply to boss", "/should/not/apply",
                "[\"inbox\",\"urgent\"]", null, "2026-07-15T00:00:00Z");

        var row = mapper.findByUserAndDomain("u1", "email").orElseThrow();
        assertThat(row.id()).isEqualTo("a1");                       // id untouched
        assertThat(row.taskCount()).isEqualTo(6);                   // + 1
        assertThat(row.lastTaskDescription()).isEqualTo("reply to boss");
        assertThat(row.topics()).isEqualTo("[\"inbox\",\"urgent\"]");
        assertThat(row.updatedAt()).isEqualTo("2026-07-15T00:00:00Z");
    }

    @Test
    void upsertKeepsExistingSessionWhenNullSuppliedAndOverwritesWhenReal() {
        // seed a session id via first upsert
        mapper.upsert("s-id", "u1", "email", "t", null, "[]", "real-sess", "2026-07-15T01:00:00Z");
        assertThat(mapper.findByUserAndDomain("u1", "email").orElseThrow().lastSessionId())
                .isEqualTo("real-sess");

        // null session on the next upsert must NOT clobber the stored one (COALESCE)
        mapper.upsert("s-id", "u1", "email", "t2", null, "[]", null, "2026-07-15T02:00:00Z");
        assertThat(mapper.findByUserAndDomain("u1", "email").orElseThrow().lastSessionId())
                .isEqualTo("real-sess");
    }

    @Test
    void markPromotedFlagsRowAndDropsItFromActiveList() {
        mapper.markPromoted("u1", "code");
        assertThat(mapper.findByUserAndDomain("u1", "code").orElseThrow().promoted()).isEqualTo(1);
        assertThat(mapper.listActiveByUser("u1")).extracting(AdhocAgentRow::domain)
                .doesNotContain("code");
    }

    private void insert(String id, String userId, String domain, int taskCount, String topics,
            int promoted, String createdAt) {
        jdbc.update("""
                INSERT INTO jarvis_adhoc_agents
                  (id, user_id, domain, task_count, last_task_description, cwd, topics,
                   last_session_id, promoted, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'seed', NULL, ?, NULL, ?, ?, ?)
                """, id, userId, domain, taskCount, topics, promoted, createdAt, createdAt);
    }
}
