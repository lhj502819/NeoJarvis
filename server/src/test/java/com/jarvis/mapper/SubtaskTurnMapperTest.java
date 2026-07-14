package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.SubTaskTurn;
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
class SubtaskTurnMapperTest {

    @Autowired
    private SubtaskTurnMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        insertTurn("t2", "s1", 2);
        insertTurn("t1", "s1", 1);
        insertTurn("t-other", "s2", 1);
    }

    @Test
    void listBySubtaskOrderedByTurnIndexAsc() {
        var rows = mapper.listBySubtask("s1");
        assertThat(rows).extracting(SubTaskTurn::turnIndex).containsExactly(1, 2);
        assertThat(rows.get(0).id()).isEqualTo("t1");
    }

    @Test
    void insertRoundTripsWithNullEndedAt() {
        // When: insert an in-flight turn (ended_at null) via the mapper
        mapper.insert("t-new", "s3", 1, "some body", "2026-07-15T00:00:00Z", null,
                "2026-07-15T00:00:00Z");

        // Then: reads back with the values written and ended_at omitted (null)
        var rows = mapper.listBySubtask("s3");
        assertThat(rows).hasSize(1);
        SubTaskTurn turn = rows.get(0);
        assertThat(turn.text()).isEqualTo("some body");
        assertThat(turn.startedAt()).isEqualTo("2026-07-15T00:00:00Z");
        assertThat(turn.endedAt()).isNull();
    }

    private void insertTurn(String id, String subtaskId, int turnIndex) {
        jdbc.update("""
                INSERT INTO jarvis_subtask_turns
                  (id, subtask_id, turn_index, text, started_at, created_at)
                VALUES (?, ?, ?, 'body', '2026-07-14', '2026-07-14')
                """, id, subtaskId, turnIndex);
    }
}
