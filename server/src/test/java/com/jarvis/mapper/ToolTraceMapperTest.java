package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.ToolTraceRow;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

/**
 * ToolTraceMapper CRUD 校验:PG JSONB 写入(::jsonb cast)+ 读出(::text)+ scope
 * 分流(jarvis via message_id / subtask via subtask_id + turn_index)。
 */
@MybatisTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Sql(scripts = "classpath:schema.sql")
class ToolTraceMapperTest {

    @Autowired
    private ToolTraceMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        // 真 PG 库跨测试不自动隔离,清空避免上一个测试类残留污染
        jdbc.execute("DELETE FROM jarvis_tool_traces");
    }

    @Test
    void subtaskScopeInsertAndListOrderedByTurnAndCall() {
        // Given: 两回合的工具调用,乱序插入
        mapper.insert("tt-1", "u1", "subtask", null, "st-a", 2, 0, "toolu_1", "Bash",
                "{\"command\":\"ls\"}", "{\"stdout\":\"a b c\"}", "a b c", false,
                null, false, "2026-07-15T00:00:01Z", "2026-07-15T00:00:02Z");
        mapper.insert("tt-2", "u1", "subtask", null, "st-a", 1, 0, "toolu_2", "Read",
                "{\"file_path\":\"/x\"}", "{\"content\":\"hi\"}", "hi", false,
                null, false, "2026-07-15T00:00:00Z", "2026-07-15T00:00:00Z");
        // 另一个子任务的 trace,不应出现在 st-a 查询里
        mapper.insert("tt-3", "u1", "subtask", null, "st-b", 1, 0, "toolu_3", "Glob",
                "{\"pattern\":\"*\"}", "{\"matches\":[]}", "[]", false,
                null, false, "2026-07-15T00:00:00Z", null);

        // When
        var rows = mapper.listBySubtask("st-a");

        // Then: 按 (turn_index, call_index) 升序
        assertThat(rows).extracting(ToolTraceRow::id).containsExactly("tt-2", "tt-1");
        assertThat(rows.get(0).toolName()).isEqualTo("Read");
        assertThat(rows.get(0).args()).contains("\"file_path\"");
        assertThat(rows.get(0).result()).contains("\"content\"");
        assertThat(rows.get(0).endedAt()).isNotNull();
    }

    @Test
    void jarvisScopeInsertAndListByMessage() {
        // Given: 同一条 assistant 消息挂两次工具调用
        mapper.insert("tt-j1", "u1", "jarvis", 42L, null, null, 0, "toolu_a", "create_task",
                "{\"name\":\"t\"}", "{\"taskId\":\"abc\"}", "abc", false,
                null, false, "2026-07-15T00:00:00Z", "2026-07-15T00:00:01Z");
        mapper.insert("tt-j2", "u1", "jarvis", 42L, null, null, 1, "toolu_b", "render_preview",
                "{\"type\":\"html\"}", null, null, false,
                null, false, "2026-07-15T00:00:02Z", null);
        // 另一条消息不干扰
        mapper.insert("tt-j3", "u1", "jarvis", 99L, null, null, 0, "toolu_c", "update_artifact",
                "{}", null, null, false, null, false, "2026-07-15T00:00:00Z", null);

        // When
        var rows = mapper.listByMessage(42L);

        // Then: 按 call_index 升序
        assertThat(rows).extracting(ToolTraceRow::id).containsExactly("tt-j1", "tt-j2");
        assertThat(rows.get(1).result()).isNull();  // render_preview 未返回
    }

    @Test
    void findByIdRoundTripsAllFields() {
        mapper.insert("tt-full", "u2", "subtask", null, "st-x", 3, 5, "toolu_full",
                "WebFetch", "{\"url\":\"https://a\"}", "{\"body\":\"long\"}",
                "long text sample", true, 128340, true,
                "2026-07-15T10:00:00Z", "2026-07-15T10:00:03Z");

        var found = mapper.findById("tt-full");
        assertThat(found).isPresent();
        ToolTraceRow row = found.get();
        assertThat(row.userId()).isEqualTo("u2");
        assertThat(row.scope()).isEqualTo("subtask");
        assertThat(row.subtaskId()).isEqualTo("st-x");
        assertThat(row.turnIndex()).isEqualTo(3);
        assertThat(row.callIndex()).isEqualTo(5);
        assertThat(row.toolCallId()).isEqualTo("toolu_full");
        assertThat(row.toolName()).isEqualTo("WebFetch");
        assertThat(row.args()).contains("https://a");
        assertThat(row.resultText()).isEqualTo("long text sample");
        assertThat(row.isError()).isTrue();
        assertThat(row.bytesOriginal()).isEqualTo(128340);
        assertThat(row.truncated()).isTrue();
    }

    @Test
    void findByIdReturnsEmptyForUnknown() {
        assertThat(mapper.findById("nope")).isEmpty();
    }
}
