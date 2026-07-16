package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.SessionRow;
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
class AgentSessionMapperTest {

    @Autowired
    private AgentSessionMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("DELETE FROM jarvis_claude_sessions");
        insertSession("u1", "sess-old", "2026-07-10T00:00:00Z");
        insertSession("u1", "sess-new", "2026-07-14T00:00:00Z");
        insertSession("u2", "sess-other", "2026-07-14T00:00:00Z");
    }

    @Test
    void listByUserNewestCompletedFirstAndScoped() {
        var rows = mapper.listByUser("u1");
        assertThat(rows).extracting(SessionRow::sessionId).containsExactly("sess-new", "sess-old");
        assertThat(rows.get(0).topics()).isEqualTo("[\"a\",\"b\"]");
    }

    @Test
    void findByUserAndSessionScoped() {
        assertThat(mapper.findByUserAndSession("u1", "sess-old")).isPresent();
        assertThat(mapper.findByUserAndSession("u1", "sess-other")).isEmpty(); // belongs to u2
        assertThat(mapper.findByUserAndSession("u1", "missing")).isEmpty();
    }

    @Test
    void listByDomainNewestFirstAndScoped() {
        var rows = mapper.listByUserAndDomain("u1", "dev");
        assertThat(rows).extracting(SessionRow::sessionId).containsExactly("sess-new", "sess-old");
        assertThat(mapper.listByUserAndDomain("u1", "nope")).isEmpty();
    }

    @Test
    void listByRecipeScoped() {
        var rows = mapper.listByUserAndRecipe("u1", "r1");
        assertThat(rows).extracting(SessionRow::sessionId).containsExactly("sess-new", "sess-old");
        assertThat(mapper.listByUserAndRecipe("u1", "other-recipe")).isEmpty();
    }

    @Test
    void insertSessionStartsAtTaskCountOne() {
        mapper.insertSession("u1", "sess-fresh", "r2", "travel", "/home", "[\"k\"]",
                "book a flight", "2026-07-15T00:00:00Z");

        var row = mapper.findByUserAndSession("u1", "sess-fresh");
        assertThat(row).isPresent();
        assertThat(row.get().taskCount()).isEqualTo(1);
        assertThat(row.get().domain()).isEqualTo("travel");
        assertThat(row.get().topics()).isEqualTo("[\"k\"]");
    }

    @Test
    void updateExistingBumpsCountMergesTopicsAndFillsBlankDomainCwd() {
        // sess-blank has empty domain/cwd so the COALESCE(NULLIF(...)) should fill them
        jdbc.update("""
                INSERT INTO jarvis_claude_sessions
                  (user_id, session_id, recipe_id, domain, cwd, topics, last_task_description,
                   completed_at, task_count)
                VALUES ('u1', 'sess-blank', 'r1', '', '', '["a"]', 'old', '2026-07-01T00:00:00Z', 2)
                """);

        mapper.updateExisting("u1", "sess-blank", "[\"a\",\"c\"]", "newer desc",
                "2026-07-15T00:00:00Z", "filled-domain", "/filled");

        var row = mapper.findByUserAndSession("u1", "sess-blank").orElseThrow();
        assertThat(row.taskCount()).isEqualTo(3);
        assertThat(row.topics()).isEqualTo("[\"a\",\"c\"]");
        assertThat(row.lastTaskDescription()).isEqualTo("newer desc");
        assertThat(row.domain()).isEqualTo("filled-domain");
        assertThat(row.cwd()).isEqualTo("/filled");
    }

    @Test
    void updateExistingKeepsNonBlankDomainCwd() {
        // sess-old already has domain='dev' cwd='/tmp' -> COALESCE keeps them
        mapper.updateExisting("u1", "sess-old", "[\"a\",\"b\"]", "desc", "2026-07-15T00:00:00Z",
                "ignored", "/ignored");

        var row = mapper.findByUserAndSession("u1", "sess-old").orElseThrow();
        assertThat(row.domain()).isEqualTo("dev");
        assertThat(row.cwd()).isEqualTo("/tmp");
    }

    @Test
    void countByUserScopedAndDeleteOldestRemovesEarliestFirst() {
        assertThat(mapper.countByUser("u1")).isEqualTo(2);

        // delete the single oldest (sess-old, completed 2026-07-10) -> sess-new remains
        mapper.deleteOldest("u1", 1);

        assertThat(mapper.countByUser("u1")).isEqualTo(1);
        assertThat(mapper.listByUser("u1")).extracting(SessionRow::sessionId)
                .containsExactly("sess-new");
        // u2 untouched
        assertThat(mapper.countByUser("u2")).isEqualTo(1);
    }

    private void insertSession(String userId, String sessionId, String completedAt) {
        jdbc.update("""
                INSERT INTO jarvis_claude_sessions
                  (user_id, session_id, recipe_id, domain, cwd, topics, last_task_description,
                   completed_at, task_count)
                VALUES (?, ?, 'r1', 'dev', '/tmp', '["a","b"]', 'did stuff', ?, 2)
                """, userId, sessionId, completedAt);
    }
}
