package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.TaskRow;
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
class TaskMapperTest {

    @Autowired
    private TaskMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        insertTask("t-old", "u1", "old", "2026-07-10T00:00:00Z", "2026-07-10T00:00:00Z");
        insertTask("t-new", "u1", "new", "2026-07-14T00:00:00Z", "2026-07-14T12:00:00Z");
        insertTask("t-other", "u2", "other user", "2026-07-14T00:00:00Z", "2026-07-14T00:00:00Z");
    }

    @Test
    void listByUserOrdersByCreatedAtDescAndScopesToUser() {
        // When
        var rows = mapper.listByUser("u1");
        // Then: only u1's tasks, newest created first
        assertThat(rows).extracting(TaskRow::id).containsExactly("t-new", "t-old");
    }

    @Test
    void listByUserSinceFiltersByUpdatedAt() {
        // When: only tasks updated after the old timestamp
        var rows = mapper.listByUserSince("u1", "2026-07-11T00:00:00Z");
        // Then
        assertThat(rows).extracting(TaskRow::id).containsExactly("t-new");
    }

    @Test
    void findByIdAndUserPresentAndAbsent() {
        assertThat(mapper.findByIdAndUser("t-new", "u1")).isPresent();
        // wrong user -> absent (user scoping)
        assertThat(mapper.findByIdAndUser("t-new", "u2")).isEmpty();
        assertThat(mapper.findByIdAndUser("missing", "u1")).isEmpty();
    }

    @Test
    void insertRoundTrips() {
        // When: a fresh task inserted via the mapper
        mapper.insert("t-ins", "u1", "fresh", "a description", "created",
                "2026-07-15T00:00:00Z", "2026-07-15T00:00:00Z");

        // Then: it reads back with the values written
        var row = mapper.findByIdAndUser("t-ins", "u1").orElseThrow();
        assertThat(row.name()).isEqualTo("fresh");
        assertThat(row.description()).isEqualTo("a description");
        assertThat(row.status()).isEqualTo("created");
        assertThat(row.createdAt()).isEqualTo("2026-07-15T00:00:00Z");
    }

    @Test
    void updateFieldsOverwritesOnlyGivenColumnsAndBumpsUpdatedAt() {
        // Given the pre-seeded t-new (status 'executing', null plan/result/error)
        // When: a merged full update (service overlays non-null over stored values)
        mapper.updateFields("t-new", "u1", "completed", "the plan", "done", null,
                "2026-07-15T09:00:00Z");

        // Then
        var row = mapper.findByIdAndUser("t-new", "u1").orElseThrow();
        assertThat(row.status()).isEqualTo("completed");
        assertThat(row.plan()).isEqualTo("the plan");
        assertThat(row.result()).isEqualTo("done");
        assertThat(row.error()).isNull();
        assertThat(row.updatedAt()).isEqualTo("2026-07-15T09:00:00Z");
    }

    @Test
    void updateFieldsScopedToUser() {
        // t-other belongs to u2; an update as u1 must not touch it
        mapper.updateFields("t-other", "u1", "completed", null, null, null, "2026-07-15T00:00:00Z");
        assertThat(mapper.findByIdAndUser("t-other", "u2").orElseThrow().status())
                .isEqualTo("executing");
    }

    @Test
    void touchBumpsOnlyUpdatedAt() {
        mapper.touch("t-old", "2026-07-15T12:00:00Z");
        var row = mapper.findByIdAndUser("t-old", "u1").orElseThrow();
        assertThat(row.updatedAt()).isEqualTo("2026-07-15T12:00:00Z");
        assertThat(row.status()).isEqualTo("executing"); // untouched
    }

    @Test
    void cancelStaleCancelsExecutingAndPlanningForUserOnly() {
        // Given: u1 t-new is 'executing'; add a 'planning' and a 'completed' task
        jdbc.update("UPDATE jarvis_tasks SET status = 'planning' WHERE id = 't-old'");
        insertTask("t-done", "u1", "done", "2026-07-14", "2026-07-14");
        jdbc.update("UPDATE jarvis_tasks SET status = 'completed' WHERE id = 't-done'");

        // When
        int affected = mapper.cancelStale("u1", "进程重启，任务自动取消", "2026-07-15T00:00:00Z");

        // Then: executing + planning cancelled with the message; completed & other user untouched
        assertThat(affected).isEqualTo(2);
        var newRow = mapper.findByIdAndUser("t-new", "u1").orElseThrow();
        assertThat(newRow.status()).isEqualTo("cancelled");
        assertThat(newRow.error()).isEqualTo("进程重启，任务自动取消");
        assertThat(mapper.findByIdAndUser("t-done", "u1").orElseThrow().status()).isEqualTo("completed");
        assertThat(mapper.findByIdAndUser("t-other", "u2").orElseThrow().status()).isEqualTo("executing");
    }

    private void insertTask(String id, String userId, String name, String createdAt, String updatedAt) {
        jdbc.update("""
                INSERT INTO jarvis_tasks (id, user_id, name, description, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'executing', ?, ?)
                """, id, userId, name, "desc", createdAt, updatedAt);
    }
}
