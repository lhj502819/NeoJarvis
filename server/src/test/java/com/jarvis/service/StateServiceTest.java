package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.JarvisState;
import com.jarvis.domain.StatePatchRequest;
import com.jarvis.mapper.StateMapper;
import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class StateServiceTest {

    private StateMapper mapper;
    private StateService service;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(StateMapper.class);
        service = new StateService(mapper);
    }

    @Test
    void getStateReturnsDefaultsWhenNoRecord() {
        // Given: no row / When
        when(mapper.findByUserId("local")).thenReturn(Optional.empty());
        JarvisState s = service.getState("local");

        // Then: TS DEFAULT_STATE values
        assertThat(s.mood()).isEqualTo(80);
        assertThat(s.energy()).isEqualTo(90);
        assertThat(s.confidence()).isEqualTo(70);
        assertThat(s.familiarity()).isEqualTo(50);
        assertThat(s.trustLevel()).isEqualTo(45);
        assertThat(s.lastDayReset()).isEqualTo(LocalDate.now().toString());
    }

    @Test
    void getStateResetsCountersOnNewDay() {
        // Given: a stored row from an earlier day
        JarvisState old = new JarvisState(60, 40, 50, 5, 9, "x", "2000-01-01", 55, 60);
        when(mapper.findByUserId("local")).thenReturn(Optional.of(old));

        // When
        JarvisState s = service.getState("local");

        // Then: energy bumped (+30, capped 95), counters reset, lastDayReset = today
        assertThat(s.energy()).isEqualTo(70);
        assertThat(s.tasksCompletedToday()).isZero();
        assertThat(s.messagesHandledToday()).isZero();
        assertThat(s.lastDayReset()).isEqualTo(LocalDate.now().toString());
        assertThat(s.mood()).isEqualTo(60);
    }

    @Test
    void patchInsertsDefaultsMergedWhenNoRecord() {
        // Given: no existing row
        when(mapper.findByUserId("local")).thenReturn(Optional.empty());
        StatePatchRequest req = new StatePatchRequest(55, null, null, null, null, null, null, null, null);

        // When
        JarvisState result = service.patchState("local", req);

        // Then: insert (not update) with mood overridden, other fields default
        verify(mapper).insert(eq("local"), any(JarvisState.class));
        verify(mapper, never()).update(any(), any());
        assertThat(result.mood()).isEqualTo(55);
        assertThat(result.energy()).isEqualTo(90);
    }

    @Test
    void patchUpdatesOnlyProvidedFieldsWhenRecordExists() {
        // Given: an existing row (today, so no reset)
        JarvisState existing = new JarvisState(80, 90, 70, 0, 0, "", LocalDate.now().toString(), 50, 45);
        when(mapper.findByUserId("local")).thenReturn(Optional.of(existing));
        StatePatchRequest req = new StatePatchRequest(null, 20, null, null, null, null, null, null, 99);

        // When
        JarvisState result = service.patchState("local", req);

        // Then: update called; energy + trustLevel changed, others preserved
        verify(mapper).update(eq("local"), any(JarvisState.class));
        assertThat(result.energy()).isEqualTo(20);
        assertThat(result.trustLevel()).isEqualTo(99);
        assertThat(result.mood()).isEqualTo(80);
        assertThat(result.confidence()).isEqualTo(70);
    }
}
