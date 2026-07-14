package com.jarvis.domain;

/**
 * Jarvis persona state (matches TS {@code JarvisState} in src/jarvis/state.ts).
 * Maps 1:1 to {@code jarvis_state} columns; the extra {@code user_id} column is ignored.
 */
public record JarvisState(
        int mood,
        int energy,
        int confidence,
        int tasksCompletedToday,
        int messagesHandledToday,
        String lastInteractionAt,
        String lastDayReset,
        int familiarity,
        int trustLevel) {
}
