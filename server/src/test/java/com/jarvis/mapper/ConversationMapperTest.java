package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.ConversationRow;
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
class ConversationMapperTest {

    @Autowired
    private ConversationMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        session("sess-old", "u1", "2026-07-10T00:00:00Z");
        session("sess-new", "u1", "2026-07-14T00:00:00Z");
        // an artifact referenced by one message
        jdbc.update("""
                INSERT INTO jarvis_artifacts (id, user_id, type, title, content, created_at, version)
                VALUES ('art-1', 'u1', 'code', 'Snippet', 'x', 100, 1)
                """);
    }

    @Test
    void findLatestSessionIdReturnsMostRecentlyUpdated() {
        assertThat(mapper.findLatestSessionId("u1")).contains("sess-new");
        assertThat(mapper.findLatestSessionId("nobody")).isEmpty();
    }

    @Test
    void insertSessionMakesItDiscoverableAsLatest() {
        mapper.insertSession("sess-fresh", "newuser",
                "2026-07-15T00:00:00Z", "2026-07-15T00:00:00Z");
        assertThat(mapper.findLatestSessionId("newuser")).contains("sess-fresh");
    }

    @Test
    void touchSessionBumpsUpdatedAtSoItBecomesLatest() {
        // sess-old (2026-07-10) trails sess-new (2026-07-14); bump it past sess-new
        mapper.touchSession("sess-old", "2026-07-20T00:00:00Z");
        assertThat(mapper.findLatestSessionId("u1")).contains("sess-old");
    }

    @Test
    void insertMessageStoresEpochMillisTimestampAndImageIds() {
        mapper.insertMessage("sess-new", "u1", "user", "hello", 1736900000000L, null, "[\"i1\"]");
        var rows = mapper.listMessages("sess-new");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).content()).isEqualTo("hello");
        assertThat(rows.get(0).timestamp()).isEqualTo(1736900000000L);
        assertThat(rows.get(0).imageIds()).isEqualTo("[\"i1\"]");
        assertThat(rows.get(0).artifactId()).isNull();
    }

    @Test
    void listMessagesOrdersAscendingAndJoinsArtifactAndImageIds() {
        // insert out of order; expect ascending by timestamp
        message("sess-new", "u1", "jarvis", "second", 2000L, "art-1", null);
        message("sess-new", "u1", "user", "first", 1000L, null, "[\"img-1\",\"img-2\"]");

        var rows = mapper.listMessages("sess-new");

        assertThat(rows).extracting(ConversationRow::content).containsExactly("first", "second");
        // first message: image ids present, no artifact
        assertThat(rows.get(0).imageIds()).isEqualTo("[\"img-1\",\"img-2\"]");
        assertThat(rows.get(0).artifactId()).isNull();
        // second message: artifact joined for type/title
        assertThat(rows.get(1).artifactId()).isEqualTo("art-1");
        assertThat(rows.get(1).artifactType()).isEqualTo("code");
        assertThat(rows.get(1).artifactTitle()).isEqualTo("Snippet");
    }

    private void session(String id, String userId, String updatedAt) {
        jdbc.update("""
                INSERT INTO user_jarvis_sessions (id, user_id, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """, id, userId, updatedAt, updatedAt);
    }

    private void message(String sessionId, String userId, String role, String content,
            long timestamp, String artifactId, String imageIds) {
        jdbc.update("""
                INSERT INTO user_jarvis_messages
                  (session_id, user_id, role, content, "timestamp", artifact_id, image_ids)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, sessionId, userId, role, content, timestamp, artifactId, imageIds);
    }
}
