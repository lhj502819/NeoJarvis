package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.SubTaskRow;
import com.jarvis.domain.SubtaskSummary;
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
class SubtaskMapperTest {

    @Autowired
    private SubtaskMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        jdbc.update("""
                INSERT INTO jarvis_tasks (id, user_id, name, description, created_at, updated_at)
                VALUES ('task-1', 'u1', 't', 'd', '2026-07-14', '2026-07-14')
                """);
    }

    @Test
    void listByTaskReturnsRowsWithRawDependsOn() {
        // Given: a subtask with a JSON depends_on and execution metadata
        jdbc.update("""
                INSERT INTO jarvis_subtasks
                  (id, task_id, user_id, name, description, assignee, status, depends_on,
                   turn_count, created_at, updated_at)
                VALUES ('s1', 'task-1', 'u1', 'sub', 'd', 'worker-a', 'completed', '["x","y"]',
                   3, '2026-07-14', '2026-07-14')
                """);

        // When
        var rows = mapper.listByTask("task-1");

        // Then: raw JSON preserved for the service to parse; ints mapped
        assertThat(rows).hasSize(1);
        SubTaskRow r = rows.get(0);
        assertThat(r.assignee()).isEqualTo("worker-a");
        assertThat(r.dependsOn()).isEqualTo("[\"x\",\"y\"]");
        assertThat(r.turnCount()).isEqualTo(3);
    }

    @Test
    void listSummaryByAssigneeNewestFirst() {
        // Given: two subtasks by the same assignee
        insertSub("s-old", "recipe-1", "2026-07-10");
        insertSub("s-new", "recipe-1", "2026-07-14");
        insertSub("s-other", "recipe-2", "2026-07-14");

        // When
        var rows = mapper.listSummaryByAssignee("u1", "recipe-1");

        // Then: only recipe-1, newest first, summary shape
        assertThat(rows).extracting(SubtaskSummary::id).containsExactly("s-new", "s-old");
        assertThat(rows.get(0).taskId()).isEqualTo("task-1");
    }

    private void insertSub(String id, String assignee, String createdAt) {
        jdbc.update("""
                INSERT INTO jarvis_subtasks
                  (id, task_id, user_id, name, description, assignee, status, created_at, updated_at)
                VALUES (?, 'task-1', 'u1', 'sub', 'd', ?, 'completed', ?, ?)
                """, id, assignee, createdAt, createdAt);
    }
}
