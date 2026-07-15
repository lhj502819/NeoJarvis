package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.ChatImage;
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
class ChatImageMapperTest {

    @Autowired
    private ChatImageMapper mapper;
    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void setUp() {
        // Legacy-row seed: data populated, uri null (pre-v0.3 shape).
        new JdbcTemplate(dataSource).update("""
                INSERT INTO jarvis_chat_images (id, user_id, media_type, data, uri, created_at)
                VALUES ('img-1', 'u1', 'image/png', 'AAECAw==', NULL, 100)
                """);
    }

    @Test
    void findByIdAndUserReturnsImageScopedToUser() {
        var img = mapper.findByIdAndUser("img-1", "u1");
        assertThat(img).isPresent();
        // Legacy shape: data set, uri null.
        assertThat(img.get().mediaType()).isEqualTo("image/png");
        assertThat(img.get().data()).isEqualTo("AAECAw==");
        assertThat(img.get().uri()).isNull();
    }

    @Test
    void findByIdAndUserAbsentForWrongUserOrMissing() {
        assertThat(mapper.findByIdAndUser("img-1", "u2")).isEmpty();
        assertThat(mapper.findByIdAndUser("nope", "u1")).isEmpty();
    }

    @Test
    void insertStoresImageWithUriAndNullData() {
        // v0.3 shape: data=null, uri=file:// pointer
        mapper.insert("img-2", "u9", "image/jpeg", null,
                "file:///tmp/u9/img-2.jpg", 1736900000000L);

        var img = mapper.findByIdAndUser("img-2", "u9");
        assertThat(img).isPresent();
        assertThat(img.get().mediaType()).isEqualTo("image/jpeg");
        assertThat(img.get().data()).isNull();
        assertThat(img.get().uri()).isEqualTo("file:///tmp/u9/img-2.jpg");
    }

    /**
     * Legacy row backwards-compat: pre-v0.3 rows have data populated and uri=NULL.
     * The read must still return the data so old images stay accessible (the controller
     * base64-decodes {@code data} when {@code uri} is null).
     */
    @Test
    void insertKeepsLegacyDataWhenUriIsNull() {
        mapper.insert("legacy-1", "u1", "image/png", "Zm9v", null, 1736900000001L);

        var img = mapper.findByIdAndUser("legacy-1", "u1");
        assertThat(img).isPresent();
        assertThat(img.get().data()).isEqualTo("Zm9v");
        assertThat(img.get().uri()).isNull();
    }
}
