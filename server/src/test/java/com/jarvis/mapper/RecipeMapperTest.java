package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.RecipeRow;
import java.util.List;
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
class RecipeMapperTest {

    @Autowired
    private RecipeMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        insertRecipe("r1", "u1", "Researcher", "[\"WebSearch\"]", "{}", 1);
        insertRecipe("r2", "u1", "Coder", "[\"Bash\",\"Edit\"]", "{\"k\":\"v\"}", 0);
        insertRecipe("r3", "u2", "OtherUser", "[]", "{}", 1);
    }

    @Test
    void listByUserScopesAndKeepsRawJson() {
        var rows = mapper.listByUser("u1");
        assertThat(rows).extracting(RecipeRow::id).containsExactlyInAnyOrder("r1", "r2");
        RecipeRow r1 = rows.stream().filter(r -> r.id().equals("r1")).findFirst().orElseThrow();
        assertThat(r1.tools()).isEqualTo("[\"WebSearch\"]");
        assertThat(r1.persistent()).isEqualTo(1);
    }

    @Test
    void findByIdsIsNotUserScoped() {
        // mirrors TS listRecipesByIds (global id lookup for assignee resolution)
        var rows = mapper.findByIds(List.of("r1", "r3", "missing"));
        assertThat(rows).extracting(RecipeRow::id).containsExactlyInAnyOrder("r1", "r3");
    }

    @Test
    void insertPersistsAllColumnsAndRoundTrips() {
        // When: insert with serialised JSON columns and a null last_used_at
        mapper.insert("r-new", "u1", "Builder", "builds", "sp", "[\"Bash\",\"Edit\"]",
                "[\"tdd\"]", "sonnet", "{\"scope\":\"repo\"}", 0, 0, "jarvis",
                "2026-07-15T00:00:00Z", null, "🔨");

        // Then: it reads back with raw JSON intact and defaults preserved
        RecipeRow row = mapper.findByIds(List.of("r-new")).get(0);
        assertThat(row.name()).isEqualTo("Builder");
        assertThat(row.tools()).isEqualTo("[\"Bash\",\"Edit\"]");
        assertThat(row.skills()).isEqualTo("[\"tdd\"]");
        assertThat(row.context()).isEqualTo("{\"scope\":\"repo\"}");
        assertThat(row.persistent()).isZero();
        assertThat(row.usageCount()).isZero();
        assertThat(row.createdBy()).isEqualTo("jarvis");
        assertThat(row.lastUsedAt()).isNull();
        assertThat(row.avatar()).isEqualTo("🔨");
    }

    @Test
    void incrementUsageBumpsCountAndStampsLastUsed() {
        // When
        mapper.incrementUsage("r2", "u1", "2026-07-15T10:00:00Z");

        // Then: usage_count 0 -> 1, last_used_at stamped
        RecipeRow row = mapper.findByIds(List.of("r2")).get(0);
        assertThat(row.usageCount()).isEqualTo(1);
        assertThat(row.lastUsedAt()).isEqualTo("2026-07-15T10:00:00Z");
    }

    @Test
    void incrementUsageIsUserScoped() {
        // r3 belongs to u2, so a u1-scoped bump is a no-op
        mapper.incrementUsage("r3", "u1", "2026-07-15T10:00:00Z");
        assertThat(mapper.findByIds(List.of("r3")).get(0).usageCount()).isZero();
    }

    @Test
    void promoteSetsPersistent() {
        // r2 starts persistent=0
        mapper.promote("r2", "u1");
        assertThat(mapper.findByIds(List.of("r2")).get(0).persistent()).isEqualTo(1);
    }

    @Test
    void removeDeletesScopedToUser() {
        mapper.remove("r1", "u1");
        assertThat(mapper.findByIds(List.of("r1"))).isEmpty();
        // wrong-user delete is a no-op
        mapper.remove("r3", "u1");
        assertThat(mapper.findByIds(List.of("r3"))).hasSize(1);
    }

    private void insertRecipe(String id, String userId, String name, String tools, String context, int persistent) {
        jdbc.update("""
                INSERT INTO jarvis_recipes
                  (id, user_id, name, description, system_prompt, tools, model, context,
                   persistent, usage_count, created_by, created_at, skills)
                VALUES (?, ?, ?, 'd', 'sp', ?, 'sonnet', ?, ?, 0, 'jarvis', '2026-07-14', '[]')
                """, id, userId, name, tools, context, persistent);
    }
}
