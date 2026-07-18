package com.jarvis;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class DatabaseSchemaTest {

    private static final List<String> ALL_TABLES = List.of(
            "jarvis_users",
            "jarvis_tasks",
            "jarvis_subtasks",
            "jarvis_recipes",
            "jarvis_claude_sessions",
            "jarvis_state",
            "user_jarvis_sessions",
            "user_jarvis_messages",
            "jarvis_artifacts",
            "jarvis_agent_threads",
            "jarvis_agent_messages",
            "jarvis_user_credentials",
            "jarvis_user_mcp_servers",
            "jarvis_subtask_turns",
            "jarvis_adhoc_agents",
            "jarvis_chat_images",
            "jarvis_skill_prefs");

    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void cleanTables() {
        // PG 真库跨测试不隔离(setUp 用 new JdbcTemplate 绕开 Spring 测试事务),
        // 手动清掉本类会写入的两张表,避免和其他测试类残留数据冲突。
        jdbc.execute("DELETE FROM jarvis_subtasks");
        jdbc.execute("DELETE FROM jarvis_tasks");
        jdbc.execute("DELETE FROM jarvis_claude_sessions");
    }

    @Test
    void allSeventeenTablesAreCreated() {
        // Given / When: schema.sql ran at datasource init
        // Then: every expected table exists (H2 stores names upper-case)
        assertThat(ALL_TABLES).hasSize(17);
        for (String table : ALL_TABLES) {
            Integer count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM information_schema.tables WHERE UPPER(table_name) = UPPER(?)",
                    Integer.class, table);
            assertThat(count).as("table %s should exist", table).isEqualTo(1);
        }
    }

    @Test
    void claudeSessionsIdIsAutoIncrement() {
        // Given: a row inserted WITHOUT specifying id
        jdbc.update("""
                INSERT INTO jarvis_claude_sessions
                  (user_id, session_id, recipe_id, last_task_description, completed_at)
                VALUES (?, ?, ?, ?, ?)
                """, "u1", "sess-1", "recipe-1", "did a thing", "2026-07-14T00:00:00Z");

        // When: reading the generated id back
        Integer id = jdbc.queryForObject(
                "SELECT id FROM jarvis_claude_sessions WHERE session_id = ?",
                Integer.class, "sess-1");

        // Then: it is a positive auto-generated integer
        assertThat(id).isNotNull().isPositive();
    }

    @Test
    void foreignKeyCascadesOnTaskDelete() {
        // Given: a task with a child subtask
        jdbc.update("""
                INSERT INTO jarvis_tasks (id, user_id, name, description, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, "task-fk", "u1", "t", "d", "2026-07-14", "2026-07-14");
        jdbc.update("""
                INSERT INTO jarvis_subtasks
                  (id, task_id, user_id, name, description, assignee, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, "sub-fk", "task-fk", "u1", "s", "d", "worker", "2026-07-14", "2026-07-14");

        // When: deleting the parent task
        jdbc.update("DELETE FROM jarvis_tasks WHERE id = ?", "task-fk");

        // Then: the child subtask is cascade-deleted
        Integer remaining = jdbc.queryForObject(
                "SELECT COUNT(*) FROM jarvis_subtasks WHERE id = ?", Integer.class, "sub-fk");
        assertThat(remaining).isZero();
    }

    @Test
    void subtasksHasFiveExecutionMetadataColumns() {
        // Given / When: the five back-filled columns are selectable
        // Then: the query does not throw (columns exist)
        assertThat(jdbc.queryForList(
                "SELECT started_at, turn_count, retry_count, tokens_input, tokens_output "
                        + "FROM jarvis_subtasks"))
                .isNotNull();
    }

    @Test
    void recipesHasSkillsColumn() {
        // Given / When / Then: skills column exists on jarvis_recipes
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.columns "
                        + "WHERE UPPER(table_name) = UPPER('jarvis_recipes') "
                        + "AND UPPER(column_name) = UPPER('skills')",
                Integer.class);
        assertThat(count).isEqualTo(1);
    }

    @Test
    void recipesHasAvatarColumn() {
        // 验证 schema.sql 的 ALTER TABLE ... ADD COLUMN IF NOT EXISTS avatar 真补进了旧库
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.columns "
                        + "WHERE UPPER(table_name) = UPPER('jarvis_recipes') "
                        + "AND UPPER(column_name) = UPPER('avatar')",
                Integer.class);
        assertThat(count).isEqualTo(1);
    }
}
