package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.ArtifactSummary;
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
class ArtifactMapperTest {

    @Autowired
    private ArtifactMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        // insert(id, user, type, title, content, createdAt, updatedAt)
        insert("a1", "u1", "code", "Login helper", "export function login()", 1000L, 5000L);
        insert("a2", "u1", "doc", "Design notes", "the rollout plan text", 2000L, null);
        insert("a3", "u2", "code", "Other user", "secret", 3000L, null);
    }

    @Test
    void listOrdersByCoalescedUpdatedThenCreatedDescAndScopesToUser() {
        // When
        var items = mapper.list("u1", null, null, 50, 0);
        // Then: only u1; a1 (updated 5000) before a2 (created 2000); no content field on summary
        assertThat(items).extracting(ArtifactSummary::id).containsExactly("a1", "a2");
        assertThat(items.get(0).updatedAt()).isEqualTo(5000L);
        assertThat(items.get(1).updatedAt()).isNull();
    }

    @Test
    void listFiltersByType() {
        var items = mapper.list("u1", "doc", null, 50, 0);
        assertThat(items).extracting(ArtifactSummary::id).containsExactly("a2");
    }

    @Test
    void listFiltersByQueryOverTitleAndContent() {
        // matches title of a1
        assertThat(mapper.list("u1", null, "Login", 50, 0))
                .extracting(ArtifactSummary::id).containsExactly("a1");
        // matches content of a2
        assertThat(mapper.list("u1", null, "rollout", 50, 0))
                .extracting(ArtifactSummary::id).containsExactly("a2");
    }

    @Test
    void listHonoursLimitAndOffset() {
        assertThat(mapper.list("u1", null, null, 1, 0)).extracting(ArtifactSummary::id)
                .containsExactly("a1");
        assertThat(mapper.list("u1", null, null, 1, 1)).extracting(ArtifactSummary::id)
                .containsExactly("a2");
    }

    @Test
    void countMatchesFilter() {
        assertThat(mapper.count("u1", null, null)).isEqualTo(2);
        assertThat(mapper.count("u1", "doc", null)).isEqualTo(1);
        assertThat(mapper.count("u1", null, "secret")).isZero(); // a3 belongs to u2
    }

    @Test
    void findDetailByIdAndUserPresentAndScoped() {
        var detail = mapper.findDetailByIdAndUser("a1", "u1");
        assertThat(detail).isPresent();
        assertThat(detail.get().content()).isEqualTo("export function login()");
        assertThat(detail.get().version()).isEqualTo(1);
        // wrong user -> absent
        assertThat(mapper.findDetailByIdAndUser("a3", "u1")).isEmpty();
    }

    @Test
    void updateContentBumpsVersionSetsUpdatedAtAndCanKeepTitle() {
        // When: content-only update (title kept)
        int rows = mapper.updateContent("a1", "u1", "patched body", null, 9000L);

        // Then: one row, version bumped 1 -> 2, title untouched, content replaced
        assertThat(rows).isEqualTo(1);
        var detail = mapper.findDetailByIdAndUser("a1", "u1");
        assertThat(detail).isPresent();
        assertThat(detail.get().content()).isEqualTo("patched body");
        assertThat(detail.get().title()).isEqualTo("Login helper");
        assertThat(detail.get().version()).isEqualTo(2);
        assertThat(jdbc.queryForObject(
                "SELECT updated_at FROM jarvis_artifacts WHERE id = 'a1'", Long.class))
                .isEqualTo(9000L);
    }

    @Test
    void updateContentAlsoUpdatesTitleWhenProvided() {
        int rows = mapper.updateContent("a2", "u1", "new plan", "New title", 9500L);

        assertThat(rows).isEqualTo(1);
        var detail = mapper.findDetailByIdAndUser("a2", "u1");
        assertThat(detail.get().title()).isEqualTo("New title");
        assertThat(detail.get().content()).isEqualTo("new plan");
    }

    @Test
    void updateContentScopedToUserReturnsZeroForWrongUserOrMissing() {
        assertThat(mapper.updateContent("a3", "u1", "x", null, 1L)).isZero(); // a3 belongs to u2
        assertThat(mapper.updateContent("does-not-exist", "u1", "x", null, 1L)).isZero();
    }

    @Test
    void insertStoresArtifactWithDefaultVersionAndEpochCreatedAt() {
        mapper.insert("new-1", "u1", "code", "Fresh helper", "the body", "ts", 1736900000000L, "task-9");

        var detail = mapper.findDetailByIdAndUser("new-1", "u1");
        assertThat(detail).isPresent();
        assertThat(detail.get().content()).isEqualTo("the body");
        // version defaults to 1 (not set on insert); created_at is the BIGINT epoch-millis
        var items = mapper.list("u1", null, "Fresh helper", 50, 0);
        assertThat(items).extracting(ArtifactSummary::id).containsExactly("new-1");
        assertThat(items.get(0).version()).isEqualTo(1);
        assertThat(items.get(0).createdAt()).isEqualTo(1736900000000L);
    }

    @Test
    void insertAcceptsNullLanguageAndTaskId() {
        mapper.insert("new-2", "u1", "doc", "NoLang", "x", null, 1736900000001L, null);
        assertThat(mapper.findDetailByIdAndUser("new-2", "u1")).isPresent();
    }

    private void insert(String id, String userId, String type, String title, String content,
            Long createdAt, Long updatedAt) {
        jdbc.update("""
                INSERT INTO jarvis_artifacts
                  (id, user_id, type, title, content, language, created_at, version, updated_at)
                VALUES (?, ?, ?, ?, ?, 'text', ?, 1, ?)
                """, id, userId, type, title, content, createdAt, updatedAt);
    }
}
