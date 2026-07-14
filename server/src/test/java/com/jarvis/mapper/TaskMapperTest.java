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

    private void insertTask(String id, String userId, String name, String createdAt, String updatedAt) {
        jdbc.update("""
                INSERT INTO jarvis_tasks (id, user_id, name, description, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'executing', ?, ?)
                """, id, userId, name, "desc", createdAt, updatedAt);
    }
}
