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

    private void insertSession(String userId, String sessionId, String completedAt) {
        jdbc.update("""
                INSERT INTO jarvis_claude_sessions
                  (user_id, session_id, recipe_id, domain, cwd, topics, last_task_description,
                   completed_at, task_count)
                VALUES (?, ?, 'r1', 'dev', '/tmp', '["a","b"]', 'did stuff', ?, 2)
                """, userId, sessionId, completedAt);
    }
}
