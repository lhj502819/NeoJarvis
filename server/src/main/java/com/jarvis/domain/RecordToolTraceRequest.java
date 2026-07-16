package com.jarvis.domain;

/**
 * Body for {@code POST /api/tool-traces} (TS 采集点发过来的一条完整工具调用).
 *
 * <p>{@code args} / {@code result} 是 JSON 字符串(TS 侧已 stringify),Java 只透传给
 * MyBatis,SQL 里用 {@code ::jsonb} cast 到 PG JSONB 列。
 *
 * <p>scope='jarvis' 时 {@code messageId} 必填、{@code subtaskId} 为 null;
 * scope='subtask' 时 {@code subtaskId} 必填、{@code messageId} 为 null。
 * (由表 CHECK 保证互斥,应用层不重复校验。)
 *
 * <p>{@code resultText} 是 TS 端从 result 摊平出来的文本(便于 50K 截断和后续组 prompt)。
 * ToolTraceService 会检查它的长度、超阈值截断并置 {@code bytesOriginal} + {@code truncated}。
 */
public record RecordToolTraceRequest(
        String scope,
        Long messageId,
        String subtaskId,
        Integer turnIndex,
        int callIndex,
        String toolCallId,
        String toolName,
        String args,
        String result,
        String resultText,
        boolean isError,
        String startedAt,
        String endedAt) {
}
