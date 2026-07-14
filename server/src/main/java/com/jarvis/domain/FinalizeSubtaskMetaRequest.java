package com.jarvis.domain;

/**
 * Body for {@code PATCH /api/subtask/{id}/meta} (mirrors TS finalizeSubtaskMeta). Writes
 * the execution accounting recorded once a subtask run completes.
 */
public record FinalizeSubtaskMetaRequest(
        int turnCount,
        int retryCount,
        int tokensInput,
        int tokensOutput) {
}
