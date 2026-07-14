package com.jarvis.domain;

/**
 * Body for {@code POST /api/subtask/{id}/turns} (mirrors TS recordTurn). Persists one
 * execution turn; {@code endedAt} may be null for an in-flight turn.
 */
public record RecordTurnRequest(
        int turnIndex,
        String text,
        String startedAt,
        String endedAt) {
}
