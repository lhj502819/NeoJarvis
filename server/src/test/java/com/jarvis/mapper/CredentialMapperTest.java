package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.Credential;
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
class CredentialMapperTest {

    @Autowired
    private CredentialMapper mapper;
    @Autowired
    private DataSource dataSource;

    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc = new JdbcTemplate(dataSource);
        insert("c1", "u1", "First", "enc-1", 1, "2026-07-10T00:00:00Z");
        insert("c2", "u1", "Second", "enc-2", 0, "2026-07-12T00:00:00Z");
        insert("c3", "u2", "Other", "enc-3", 1, "2026-07-11T00:00:00Z");
    }

    @Test
    void listSafeByUserNeverExposesEncryptedKeyAndIsScopedOrdered() {
        // When
        var creds = mapper.listSafeByUser("u1");
        // Then: only u1, oldest first; boolean default mapped; Credential has no key field
        assertThat(creds).extracting(Credential::id).containsExactly("c1", "c2");
        assertThat(creds.get(0).isDefault()).isTrue();
        assertThat(creds.get(1).isDefault()).isFalse();
    }

    @Test
    void findByIdAndUserCarriesEncryptedKeyForInternalUse() {
        var row = mapper.findByIdAndUser("c1", "u1");
        assertThat(row).isPresent();
        assertThat(row.get().apiKeyEnc()).isEqualTo("enc-1");
        assertThat(row.get().isDefault()).isTrue();
        assertThat(mapper.findByIdAndUser("c1", "u2")).isEmpty();
    }

    @Test
    void countByUserScopes() {
        assertThat(mapper.countByUser("u1")).isEqualTo(2);
        assertThat(mapper.countByUser("nobody")).isZero();
    }

    @Test
    void insertUpdateClearDefaultAndDelete() {
        // insert a new default and clear the others
        mapper.clearDefault("u1");
        mapper.insert("c4", "u1", "Fourth", "prod", "enc-4", "https://x", "sonnet", 1,
                "2026-07-13T00:00:00Z", "2026-07-13T00:00:00Z");
        assertThat(mapper.findByIdAndUser("c1", "u1").get().isDefault()).isFalse();
        assertThat(mapper.findByIdAndUser("c4", "u1").get().isDefault()).isTrue();

        // update fields
        mapper.update("c4", "u1", "Renamed", "prod", "enc-4b", "https://y", "opus", 0,
                "2026-07-14T00:00:00Z");
        var updated = mapper.findByIdAndUser("c4", "u1").get();
        assertThat(updated.label()).isEqualTo("Renamed");
        assertThat(updated.apiKeyEnc()).isEqualTo("enc-4b");
        assertThat(updated.isDefault()).isFalse();

        // delete + earliest lookup + setDefault
        mapper.delete("c4", "u1");
        assertThat(mapper.findByIdAndUser("c4", "u1")).isEmpty();
        assertThat(mapper.findEarliestId("u1")).contains("c1");
        mapper.setDefault("c1", "u1");
        assertThat(mapper.findByIdAndUser("c1", "u1").get().isDefault()).isTrue();
    }

    private void insert(String id, String userId, String label, String enc, int isDefault,
            String createdAt) {
        jdbc.update("""
                INSERT INTO jarvis_user_credentials
                  (id, user_id, label, tier, api_key_enc, base_url, model, is_default, created_at, updated_at)
                VALUES (?, ?, ?, 'standard', ?, 'https://api', 'sonnet', ?, ?, ?)
                """, id, userId, label, enc, isDefault, createdAt, createdAt);
    }
}
