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
class SkillPrefsMapperTest {

    @Autowired
    private SkillPrefsMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
    }

    @Test
    void listDisabledIsScopedToUser() {
        mapper.insertIgnore("u1", "baoyu-comic");
        mapper.insertIgnore("u1", "deep-research");
        mapper.insertIgnore("u2", "handoff");

        assertThat(mapper.listDisabled("u1")).containsExactlyInAnyOrder("baoyu-comic", "deep-research");
        assertThat(mapper.listDisabled("u2")).containsExactly("handoff");
    }

    @Test
    void insertIgnoreIsIdempotentOnCompositeKey() {
        // Re-inserting the same (user, skill) must not throw (INSERT IGNORE) nor duplicate.
        assertThatCode(() -> {
            mapper.insertIgnore("u1", "deep-research");
            mapper.insertIgnore("u1", "deep-research");
        }).doesNotThrowAnyException();
        assertThat(mapper.listDisabled("u1")).containsExactly("deep-research");
    }

    @Test
    void deleteRemovesTheBlacklistRow() {
        mapper.insertIgnore("u1", "deep-research");
        mapper.delete("u1", "deep-research");
        assertThat(mapper.listDisabled("u1")).isEmpty();
    }
}
