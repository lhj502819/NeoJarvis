package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.User;
import com.jarvis.domain.UserRow;
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
class UserMapperTest {

    @Autowired
    private UserMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        insert("u1", "alice", "Alice", "hash1", "salt1", "admin", "2026-07-10T00:00:00Z");
        insert("u2", "bob", "Bob", "hash2", "salt2", "user", "2026-07-11T00:00:00Z");
    }

    @Test
    void findRowByUsernameCarriesHashAndSalt() {
        UserRow row = mapper.findRowByUsername("alice").orElseThrow();
        assertThat(row.id()).isEqualTo("u1");
        assertThat(row.displayName()).isEqualTo("Alice");
        assertThat(row.passwordHash()).isEqualTo("hash1");
        assertThat(row.salt()).isEqualTo("salt1");
        assertThat(row.role()).isEqualTo("admin");
        assertThat(mapper.findRowByUsername("nobody")).isEmpty();
    }

    @Test
    void findRowByIdResolvesUser() {
        assertThat(mapper.findRowById("u2").orElseThrow().username()).isEqualTo("bob");
        assertThat(mapper.findRowById("missing")).isEmpty();
    }

    @Test
    void countAndFindRole() {
        assertThat(mapper.count()).isEqualTo(2);
        assertThat(mapper.findRole("u1")).contains("admin");
        assertThat(mapper.findRole("u2")).contains("user");
        assertThat(mapper.findRole("missing")).isEmpty();
    }

    @Test
    void listSafeOmitsHashAndSaltOrderedByCreatedAt() {
        var users = mapper.listSafe();
        assertThat(users).extracting(User::username).containsExactly("alice", "bob");
        // User record structurally has no hash/salt fields — redaction by type.
        assertThat(users.get(0).role()).isEqualTo("admin");
    }

    @Test
    void insertAndDelete() {
        mapper.insert("u3", "carol", "Carol", "h3", "s3", "user", "2026-07-12T00:00:00Z");
        assertThat(mapper.findRowByUsername("carol")).isPresent();
        assertThat(mapper.count()).isEqualTo(3);

        mapper.delete("u3");
        assertThat(mapper.findRowByUsername("carol")).isEmpty();
    }

    private void insert(String id, String username, String displayName, String hash, String salt,
            String role, String createdAt) {
        jdbc.update("""
                INSERT INTO jarvis_users
                  (id, username, display_name, password_hash, salt, role, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, id, username, displayName, hash, salt, role, createdAt);
    }
}
