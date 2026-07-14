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
        new JdbcTemplate(dataSource).update("""
                INSERT INTO jarvis_chat_images (id, user_id, media_type, data, created_at)
                VALUES ('img-1', 'u1', 'image/png', 'AAECAw==', 100)
                """);
    }

    @Test
    void findByIdAndUserReturnsImageScopedToUser() {
        var img = mapper.findByIdAndUser("img-1", "u1");
        assertThat(img).isPresent();
        assertThat(img.get().mediaType()).isEqualTo("image/png");
        assertThat(img.get().data()).isEqualTo("AAECAw==");
    }

    @Test
    void findByIdAndUserAbsentForWrongUserOrMissing() {
        assertThat(mapper.findByIdAndUser("img-1", "u2")).isEmpty();
        assertThat(mapper.findByIdAndUser("nope", "u1")).isEmpty();
    }
}
