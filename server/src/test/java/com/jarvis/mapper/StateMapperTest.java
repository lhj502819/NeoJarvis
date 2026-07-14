package com.jarvis.mapper;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.JarvisState;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.boot.test.autoconfigure.MybatisTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

@MybatisTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Sql(scripts = "classpath:schema.sql")
class StateMapperTest {

    @Autowired
    private StateMapper mapper;

    @Test
    void findByUserIdEmptyWhenNoRow() {
        // Given: no state row / When: querying / Then: empty Optional
        assertThat(mapper.findByUserId("nobody")).isEmpty();
    }

    @Test
    void insertThenFindRoundTrips() {
        // Given: an inserted state
        JarvisState s = new JarvisState(80, 90, 70, 0, 0, "", "2026-07-14", 50, 45);
        mapper.insert("u1", s);

        // When: reading it back
        JarvisState found = mapper.findByUserId("u1").orElseThrow();

        // Then: values survive the round trip
        assertThat(found.mood()).isEqualTo(80);
        assertThat(found.energy()).isEqualTo(90);
        assertThat(found.familiarity()).isEqualTo(50);
        assertThat(found.trustLevel()).isEqualTo(45);
        assertThat(found.lastDayReset()).isEqualTo("2026-07-14");
    }

    @Test
    void updateChangesStoredFields() {
        // Given: an existing row
        mapper.insert("u2", new JarvisState(80, 90, 70, 0, 0, "", "2026-07-14", 50, 45));

        // When: updating with new values
        mapper.update("u2", new JarvisState(55, 40, 33, 2, 3, "2026-07-14T10:00:00Z",
                "2026-07-14", 60, 70));

        // Then: the update is persisted
        JarvisState found = mapper.findByUserId("u2").orElseThrow();
        assertThat(found.mood()).isEqualTo(55);
        assertThat(found.tasksCompletedToday()).isEqualTo(2);
        assertThat(found.trustLevel()).isEqualTo(70);
    }
}
