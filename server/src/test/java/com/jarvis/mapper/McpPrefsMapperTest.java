package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

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
class McpPrefsMapperTest {

    @Autowired
    private McpPrefsMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
    }

    @Test
    void listDisabledIsScopedToUser() {
        mapper.insertIgnore("u1", "chrome-devtools");
        mapper.insertIgnore("u1", "context7");
        mapper.insertIgnore("u2", "figma");

        assertThat(mapper.listDisabled("u1"))
                .containsExactlyInAnyOrder("chrome-devtools", "context7");
        assertThat(mapper.listDisabled("u2")).containsExactly("figma");
    }

    @Test
    void insertIgnoreIsIdempotentOnCompositeKey() {
        // Re-inserting the same (user, mcp) must not throw (INSERT IGNORE) nor duplicate.
        assertThatCode(() -> {
            mapper.insertIgnore("u1", "chrome-devtools");
            mapper.insertIgnore("u1", "chrome-devtools");
        }).doesNotThrowAnyException();
        assertThat(mapper.listDisabled("u1")).containsExactly("chrome-devtools");
    }

    @Test
    void deleteRemovesTheBlacklistRow() {
        mapper.insertIgnore("u1", "chrome-devtools");
        mapper.delete("u1", "chrome-devtools");
        assertThat(mapper.listDisabled("u1")).isEmpty();
    }
}
