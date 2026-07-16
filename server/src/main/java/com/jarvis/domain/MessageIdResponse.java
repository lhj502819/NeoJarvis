package com.jarvis.domain;

/**
 * POST /api/conversation/messages 返回体。带上自增主键 id,供 TS 侧记录工具调用 traces
 * 时按 message_id 关联(scope='jarvis')。
 */
public record MessageIdResponse(long id) {
}
