package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.McpServerRow;
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
class McpServerMapperTest {

    @Autowired
    private McpServerMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        insert("m1", "u1", "fs", "stdio", "npx", "[\"-y\",\"fs\"]", null, "enc-1", 1,
                "2026-07-10T00:00:00Z");
        insert("m2", "u1", "web", "http", null, null, "https://x", null, 0,
                "2026-07-11T00:00:00Z");
        insert("m3", "u2", "fs", "stdio", "npx", null, null, null, 1, "2026-07-10T00:00:00Z");
    }

    @Test
    void listByUserScopesAndOrdersOldestFirstCarryingEncColumn() {
        var rows = mapper.listByUser("u1");
        assertThat(rows).extracting(McpServerRow::name).containsExactly("fs", "web");
        assertThat(rows.get(0).envEnc()).isEqualTo("enc-1");
        assertThat(rows.get(0).enabled()).isEqualTo(1);
        assertThat(rows.get(1).enabled()).isZero();
    }

    @Test
    void findByUserAndNameScopesByUser() {
        assertThat(mapper.findByUserAndName("u1", "fs")).isPresent();
        assertThat(mapper.findByUserAndName("u1", "fs").get().argsJson()).isEqualTo("[\"-y\",\"fs\"]");
        assertThat(mapper.findByUserAndName("nobody", "fs")).isEmpty();
    }

    @Test
    void listEnabledByUserFiltersDisabledAndScopesByUser() {
        // u1 has fs(enabled) + web(disabled); only fs comes back, carrying env_enc
        var rows = mapper.listEnabledByUser("u1");
        assertThat(rows).extracting(McpServerRow::name).containsExactly("fs");
        assertThat(rows.get(0).envEnc()).isEqualTo("enc-1");
        assertThat(mapper.listEnabledByUser("nobody")).isEmpty();
    }

    @Test
    void insertUpdateDelete() {
        mapper.insert("m4", "u1", "db", "sse", null, null, "https://db", "enc-4", "database",
                "2026-07-13T00:00:00Z", "2026-07-13T00:00:00Z");
        // enabled defaults to 1 on insert
        assertThat(mapper.findByUserAndName("u1", "db").orElseThrow().enabled()).isEqualTo(1);

        mapper.update("u1", "db", "sse", null, "[\"--verbose\"]", "https://db2", "enc-4b", "renamed",
                0, "2026-07-14T00:00:00Z");
        var updated = mapper.findByUserAndName("u1", "db").orElseThrow();
        assertThat(updated.url()).isEqualTo("https://db2");
        assertThat(updated.argsJson()).isEqualTo("[\"--verbose\"]");
        assertThat(updated.envEnc()).isEqualTo("enc-4b");
        assertThat(updated.enabled()).isZero();

        assertThat(mapper.delete("u1", "db")).isEqualTo(1);
        assertThat(mapper.findByUserAndName("u1", "db")).isEmpty();
        assertThat(mapper.delete("u1", "db")).isZero();
    }

    private void insert(String id, String userId, String name, String transport, String command,
            String argsJson, String url, String envEnc, int enabled, String createdAt) {
        jdbc.update("""
                INSERT INTO jarvis_user_mcp_servers
                  (id, user_id, name, transport, command, args_json, url, env_enc, description,
                   enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
                """, id, userId, name, transport, command, argsJson, url, envEnc, enabled,
                createdAt, createdAt);
    }
}
