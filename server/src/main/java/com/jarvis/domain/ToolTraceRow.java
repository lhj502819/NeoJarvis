package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 一次工具调用的完整记录(tool_use + 匹配的 tool_result)。1:1 映射到
 * {@code jarvis_tool_traces} 表。参考 Letta 的做法,把 tool_call/tool_result
 * 作为一等公民,LLM 下一轮能看到"上一步调了什么、返回了什么"。
 *
 * <p>scope 决定归属:{@code jarvis} 挂 {@link #messageId}(user_jarvis_messages SERIAL),
 * {@code subtask} 挂 {@link #subtaskId} + {@link #turnIndex}。表 CHECK 保证互斥。
 *
 * <p>{@code args}/{@code result} 是 JSON 文本(Java 内不 parse),PG 侧存 JSONB。
 * {@code resultText} 是从 result 摊平出来的纯文本快照,50K 截断作用在此列,方便组 prompt
 * 直接用不必反序列化。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ToolTraceRow(
        String id,
        String userId,
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
        Integer bytesOriginal,
        boolean truncated,
        String startedAt,
        String endedAt,
        String createdAt) {
}
