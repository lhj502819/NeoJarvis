package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

/**
 * MemoryResetMapper 校验:清一个用户的对话 + 执行痕迹,断言 8 类目标表清空(含 FK 级联子表)、
 * 保留表(recipes/artifacts/credentials)不受影响、其他用户的数据不受影响。
 */
@MybatisTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Sql(scripts = "classpath:schema.sql")
class MemoryResetMapperTest {

    private static final String U = "reset-user";
    private static final String OTHER = "keep-user";

    @Autowired
    private MemoryResetMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        cleanup();
        seedForUser(U);
        seedForUser(OTHER);
    }

    @AfterEach
    void tearDown() {
        cleanup();
    }

    @Test
    void clearMemoryWipesAllTargetTablesForUser() {
        // When: 按 service 编排的顺序执行 8 步删除
        mapper.deleteSubtaskTurns(U);
        mapper.deleteTasks(U);
        mapper.deleteAgentThreads(U);
        mapper.deleteToolTraces(U);
        mapper.deleteChatImages(U);
        mapper.deleteClaudeSessions(U);
        mapper.deleteState(U);
        mapper.deleteConversationSessions(U);

        // Then: 该用户 8 类目标表(含级联子表)全部归 0
        assertThat(countTurns(U)).isZero();                       // jarvis_subtask_turns
        assertThat(count("jarvis_subtasks", U)).isZero();         // 级联 from tasks
        assertThat(count("jarvis_tasks", U)).isZero();
        assertThat(countAgentMessages(U)).isZero();               // 级联 from threads
        assertThat(count("jarvis_agent_threads", U)).isZero();
        assertThat(count("jarvis_tool_traces", U)).isZero();
        assertThat(count("jarvis_chat_images", U)).isZero();
        assertThat(count("jarvis_claude_sessions", U)).isZero();
        assertThat(count("jarvis_state", U)).isZero();
        assertThat(count("user_jarvis_messages", U)).isZero();    // 级联 from sessions
        assertThat(count("user_jarvis_sessions", U)).isZero();
    }

    @Test
    void clearMemoryPreservesTeamArtifactsCredentials() {
        // When
        mapper.deleteSubtaskTurns(U);
        mapper.deleteTasks(U);
        mapper.deleteAgentThreads(U);
        mapper.deleteToolTraces(U);
        mapper.deleteChatImages(U);
        mapper.deleteClaudeSessions(U);
        mapper.deleteState(U);
        mapper.deleteConversationSessions(U);

        // Then: 保留表未被动
        assertThat(count("jarvis_recipes", U)).isEqualTo(1);
        assertThat(count("jarvis_artifacts", U)).isEqualTo(1);
        assertThat(count("jarvis_user_credentials", U)).isEqualTo(1);
    }

    @Test
    void clearMemoryDoesNotTouchOtherUsers() {
        // When: 只清 U
        mapper.deleteSubtaskTurns(U);
        mapper.deleteTasks(U);
        mapper.deleteAgentThreads(U);
        mapper.deleteToolTraces(U);
        mapper.deleteChatImages(U);
        mapper.deleteClaudeSessions(U);
        mapper.deleteState(U);
        mapper.deleteConversationSessions(U);

        // Then: OTHER 用户的目标表数据仍在
        assertThat(countTurns(OTHER)).isEqualTo(1);
        assertThat(count("jarvis_tasks", OTHER)).isEqualTo(1);
        assertThat(count("jarvis_agent_threads", OTHER)).isEqualTo(1);
        assertThat(count("jarvis_tool_traces", OTHER)).isEqualTo(1);
        assertThat(count("jarvis_chat_images", OTHER)).isEqualTo(1);
        assertThat(count("jarvis_claude_sessions", OTHER)).isEqualTo(1);
        assertThat(count("jarvis_state", OTHER)).isEqualTo(1);
        assertThat(count("user_jarvis_sessions", OTHER)).isEqualTo(1);
    }

    // ─── seed / cleanup ───

    private void seedForUser(String u) {
        // 对话:session + message(message 靠 FK 级联)
        jdbc.update("INSERT INTO user_jarvis_sessions (id, user_id, created_at, updated_at) "
                + "VALUES (?, ?, '2026-07-14', '2026-07-14')", "sess-" + u, u);
        jdbc.update("INSERT INTO user_jarvis_messages (session_id, user_id, role, content, \"timestamp\") "
                + "VALUES (?, ?, 'user', 'hi', 1)", "sess-" + u, u);

        // 任务 + 子任务(子任务靠 FK 级联)+ 子任务轨迹(无 user_id,挂 subtask_id)
        jdbc.update("INSERT INTO jarvis_tasks (id, user_id, name, description, status, created_at, updated_at) "
                + "VALUES (?, ?, 'n', 'd', 'completed', '2026-07-14', '2026-07-14')", "task-" + u, u);
        jdbc.update("INSERT INTO jarvis_subtasks (id, task_id, user_id, name, description, assignee, created_at, updated_at) "
                + "VALUES (?, ?, ?, 'n', 'd', 'a', '2026-07-14', '2026-07-14')", "sub-" + u, "task-" + u, u);
        jdbc.update("INSERT INTO jarvis_subtask_turns (id, subtask_id, turn_index, text, started_at, created_at) "
                + "VALUES (?, ?, 1, 'body', '2026-07-14', '2026-07-14')", "turn-" + u, "sub-" + u);

        // A2A 沟通:thread + message(message 靠 FK 级联)
        jdbc.update("INSERT INTO jarvis_agent_threads (id, user_id, participants, created_at, updated_at) "
                + "VALUES (?, ?, '[]', '2026-07-14', '2026-07-14')", "thr-" + u, u);
        jdbc.update("INSERT INTO jarvis_agent_messages (id, thread_id, sender, receiver, role, parts, \"timestamp\") "
                + "VALUES (?, ?, 'jarvis', 'x', 'user', '[]', '2026-07-14')", "msg-" + u, "thr-" + u);

        // 工具调用记录(JSONB;scope=subtask 时约束要求 subtask_id + turn_index 非空)
        jdbc.update("INSERT INTO jarvis_tool_traces "
                + "(id, user_id, scope, subtask_id, turn_index, call_index, tool_call_id, tool_name, args, started_at) "
                + "VALUES (?, ?, 'subtask', ?, 1, 0, 'tc', 'Bash', '{}'::jsonb, NOW())", "tt-" + u, u, "sub-" + u);

        // 聊天图片
        jdbc.update("INSERT INTO jarvis_chat_images (id, user_id, media_type, created_at) "
                + "VALUES (?, ?, 'image/png', 1)", "img-" + u, u);

        // 小弟 SDK 会话(仅需 user_id 存在即可计数)
        jdbc.update("INSERT INTO jarvis_claude_sessions "
                + "(user_id, session_id, recipe_id, last_task_description, completed_at) "
                + "VALUES (?, 'sid-" + u + "', 'rec', 'd', '2026-07-14')", u);

        // Jarvis 运行态(主键 user_id)
        jdbc.update("INSERT INTO jarvis_state (user_id, last_day_reset) VALUES (?, '2026-07-14')", u);

        // 保留表:recipe / artifact / credential
        jdbc.update("INSERT INTO jarvis_recipes (id, user_id, name, description, system_prompt, tools, created_at) "
                + "VALUES (?, ?, 'r', 'd', 'p', '[]', '2026-07-14')", "rec-" + u, u);
        jdbc.update("INSERT INTO jarvis_artifacts (id, user_id, type, title, content, version, created_at, updated_at) "
                + "VALUES (?, ?, 'markdown', 't', 'c', 1, 1, 1)", "art-" + u, u);
        jdbc.update("INSERT INTO jarvis_user_credentials (id, user_id, label, tier, api_key_enc, base_url, model, is_default, created_at, updated_at) "
                + "VALUES (?, ?, 'l', 'default', 'k', 'u', 'm', 0, '2026-07-14', '2026-07-14')", "cred-" + u, u);
    }

    private void cleanup() {
        // 子表在前、父表在后(FK)。两个用户都清。
        for (String u : new String[] { U, OTHER }) {
            jdbc.update("DELETE FROM jarvis_subtask_turns WHERE subtask_id IN (SELECT id FROM jarvis_subtasks WHERE user_id = ?)", u);
            jdbc.update("DELETE FROM jarvis_tasks WHERE user_id = ?", u);
            jdbc.update("DELETE FROM jarvis_agent_threads WHERE user_id = ?", u);
            jdbc.update("DELETE FROM jarvis_tool_traces WHERE user_id = ?", u);
            jdbc.update("DELETE FROM jarvis_chat_images WHERE user_id = ?", u);
            jdbc.update("DELETE FROM jarvis_claude_sessions WHERE user_id = ?", u);
            jdbc.update("DELETE FROM jarvis_state WHERE user_id = ?", u);
            jdbc.update("DELETE FROM user_jarvis_sessions WHERE user_id = ?", u);
            jdbc.update("DELETE FROM jarvis_recipes WHERE user_id = ?", u);
            jdbc.update("DELETE FROM jarvis_artifacts WHERE user_id = ?", u);
            jdbc.update("DELETE FROM jarvis_user_credentials WHERE user_id = ?", u);
        }
    }

    private int count(String table, String userId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE user_id = ?", Integer.class, userId);
    }

    private int countTurns(String userId) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM jarvis_subtask_turns WHERE subtask_id IN "
                        + "(SELECT id FROM jarvis_subtasks WHERE user_id = ?)",
                Integer.class, userId);
    }

    private int countAgentMessages(String userId) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM jarvis_agent_messages WHERE thread_id IN "
                        + "(SELECT id FROM jarvis_agent_threads WHERE user_id = ?)",
                Integer.class, userId);
    }
}
