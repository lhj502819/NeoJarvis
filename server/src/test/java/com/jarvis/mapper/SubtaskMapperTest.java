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

    @Test
    void insertAndFindByIdAndUserRoundTrip() {
        // When: insert via the mapper (status forced to 'pending', depends_on JSON stored raw)
        mapper.insert("s-ins", "task-1", "u1", "sub", "d", "worker-a", "coding", "/tmp",
                "[\"a\",\"b\"]", "2026-07-15T00:00:00Z", "2026-07-15T00:00:00Z");

        // Then: reads back with pending status and raw depends_on preserved
        SubTaskRow r = mapper.findByIdAndUser("s-ins", "u1").orElseThrow();
        assertThat(r.status()).isEqualTo("pending");
        assertThat(r.assignee()).isEqualTo("worker-a");
        assertThat(r.domain()).isEqualTo("coding");
        assertThat(r.cwd()).isEqualTo("/tmp");
        assertThat(r.dependsOn()).isEqualTo("[\"a\",\"b\"]");
        // wrong user -> absent
        assertThat(mapper.findByIdAndUser("s-ins", "u2")).isEmpty();
    }

    @Test
    void insertAllowsNullOptionalColumns() {
        mapper.insert("s-min", "task-1", "u1", "sub", "d", "worker-a", null, null, null,
                "2026-07-15T00:00:00Z", "2026-07-15T00:00:00Z");
        SubTaskRow r = mapper.findByIdAndUser("s-min", "u1").orElseThrow();
        assertThat(r.domain()).isNull();
        assertThat(r.dependsOn()).isNull();
    }

    @Test
    void updateFieldsOverwritesMutableColumns() {
        mapper.insert("s-upd", "task-1", "u1", "sub", "d", "worker-a", null, null, null,
                "2026-07-15", "2026-07-15");
        // When: merged full update
        mapper.updateFields("s-upd", "running", "50%", "partial", null, "waiting on x",
                "2026-07-15T09:00:00Z");
        // Then
        SubTaskRow r = mapper.findByIdAndUser("s-upd", "u1").orElseThrow();
        assertThat(r.status()).isEqualTo("running");
        assertThat(r.progress()).isEqualTo("50%");
        assertThat(r.result()).isEqualTo("partial");
        assertThat(r.error()).isNull();
        assertThat(r.blockedReason()).isEqualTo("waiting on x");
        assertThat(r.updatedAt()).isEqualTo("2026-07-15T09:00:00Z");
    }

    @Test
    void setStartedAndFinalizeMetaPersist() {
        mapper.insert("s-meta", "task-1", "u1", "sub", "d", "worker-a", null, null, null,
                "2026-07-15", "2026-07-15");
        mapper.setStarted("s-meta", "2026-07-15T08:00:00Z");
        mapper.finalizeMeta("s-meta", 4, 1, 1200, 800);
        SubTaskRow r = mapper.findByIdAndUser("s-meta", "u1").orElseThrow();
        assertThat(r.startedAt()).isEqualTo("2026-07-15T08:00:00Z");
        assertThat(r.turnCount()).isEqualTo(4);
        assertThat(r.retryCount()).isEqualTo(1);
        assertThat(r.tokensInput()).isEqualTo(1200);
        assertThat(r.tokensOutput()).isEqualTo(800);
    }

    @Test
    void cancelStaleCancelsRunningAndPendingForUserOnly() {
        insertSub("s-run", "worker-a", "2026-07-15");
        jdbc.update("UPDATE jarvis_subtasks SET status = 'running' WHERE id = 's-run'");
        insertSub("s-pend", "worker-a", "2026-07-15");
        jdbc.update("UPDATE jarvis_subtasks SET status = 'pending' WHERE id = 's-pend'");
        insertSub("s-done", "worker-a", "2026-07-15"); // completed via insertSub helper

        int affected = mapper.cancelStale("u1", "2026-07-15T00:00:00Z");

        assertThat(affected).isEqualTo(2);
        assertThat(mapper.findByIdAndUser("s-run", "u1").orElseThrow().status()).isEqualTo("cancelled");
        assertThat(mapper.findByIdAndUser("s-pend", "u1").orElseThrow().status()).isEqualTo("cancelled");
        assertThat(mapper.findByIdAndUser("s-done", "u1").orElseThrow().status()).isEqualTo("completed");
    }

    private void insertSub(String id, String assignee, String createdAt) {
        jdbc.update("""
                INSERT INTO jarvis_subtasks
                  (id, task_id, user_id, name, description, assignee, status, created_at, updated_at)
                VALUES (?, 'task-1', 'u1', 'sub', 'd', ?, 'completed', ?, ?)
                """, id, assignee, createdAt, createdAt);
    }
}
