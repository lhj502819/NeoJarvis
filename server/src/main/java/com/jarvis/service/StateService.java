package com.jarvis.service;

import com.jarvis.domain.JarvisState;
import com.jarvis.domain.StatePatchRequest;
import com.jarvis.mapper.StateMapper;
import java.time.LocalDate;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Jarvis persona state. Ports src/jarvis/state.ts: default values when no row exists,
 * the read-time "new day" reset, and an upsert-based patch.
 */
@Service
public class StateService {

    private static final Logger log = LoggerFactory.getLogger(StateService.class);

    private final StateMapper stateMapper;

    public StateService(StateMapper stateMapper) {
        this.stateMapper = stateMapper;
    }

    /** Effective state for reads: raw row (or defaults) with the new-day reset applied. */
    @Transactional(readOnly = true)
    public JarvisState getState(String userId) {
        return resetIfNewDay(rawOrDefault(userId));
    }

    /** Apply only the provided fields over the current stored state, then persist. */
    @Transactional
    public JarvisState patchState(String userId, StatePatchRequest req) {
        // Single read: presence decides insert-vs-update, value is the overlay base (IMPORTANT-1).
        Optional<JarvisState> existing = stateMapper.findByUserId(userId);
        JarvisState merged = overlay(existing.orElseGet(StateService::defaultState), req);
        if (existing.isPresent()) {
            stateMapper.update(userId, merged);
        } else {
            stateMapper.insert(userId, merged);
        }
        log.debug("patch_state userId={} exists={}", userId, existing.isPresent());
        return merged;
    }

    // ─── helpers ───

    private JarvisState rawOrDefault(String userId) {
        return stateMapper.findByUserId(userId).orElseGet(StateService::defaultState);
    }

    private static JarvisState defaultState() {
        return new JarvisState(80, 90, 70, 0, 0, "", today(), 50, 45);
    }

    private static JarvisState resetIfNewDay(JarvisState s) {
        String today = today();
        if (today.equals(s.lastDayReset())) {
            return s;
        }
        return new JarvisState(s.mood(), Math.min(95, s.energy() + 30), s.confidence(),
                0, 0, s.lastInteractionAt(), today, s.familiarity(), s.trustLevel());
    }

    private static JarvisState overlay(JarvisState s, StatePatchRequest r) {
        return new JarvisState(
                r.mood() != null ? r.mood() : s.mood(),
                r.energy() != null ? r.energy() : s.energy(),
                r.confidence() != null ? r.confidence() : s.confidence(),
                r.tasksCompletedToday() != null ? r.tasksCompletedToday() : s.tasksCompletedToday(),
                r.messagesHandledToday() != null ? r.messagesHandledToday() : s.messagesHandledToday(),
                r.lastInteractionAt() != null ? r.lastInteractionAt() : s.lastInteractionAt(),
                r.lastDayReset() != null ? r.lastDayReset() : s.lastDayReset(),
                r.familiarity() != null ? r.familiarity() : s.familiarity(),
                r.trustLevel() != null ? r.trustLevel() : s.trustLevel());
    }

    private static String today() {
        return LocalDate.now().toString();
    }
}
