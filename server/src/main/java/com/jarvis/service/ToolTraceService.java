package com.jarvis.service;

import com.jarvis.domain.RecordToolTraceRequest;
import com.jarvis.domain.ToolTraceRow;
import com.jarvis.mapper.ToolTraceMapper;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 工具调用完整历史写读服务。写入前对 {@code resultText} 做 50K 硬截断,超阈值把
 * {@code truncated=true} + {@code bytesOriginal=原始长度} 记下,便于前端提示"已截断"
 * 且未来能追溯到原始体积。截断仅作用在 resultText(纯文本快照);args/result JSONB 保
 * 结构化(实际上 args 通常也小,大头是 result 的 bash/read/webfetch 输出)。
 *
 * <p>为什么截断放在 Java 服务层:任何 TS 采集点接进来都受同一阈值保护,不用信客户端。
 * 5K 上下文层的进一步压缩不在此处 —— 那在 TS conversation.ts 组 prompt 时做,分层。
 */
@Service
public class ToolTraceService {

    private static final Logger log = LoggerFactory.getLogger(ToolTraceService.class);

    /** 入库截断上限(字符数,不是字节)。超过则截尾并置 truncated=true。 */
    static final int RESULT_TEXT_LIMIT = 50_000;

    /** args JSONB 兜底截断(几乎用不到,防被写入大 payload 时 PG JSONB parser 卡住)。 */
    static final int ARGS_JSON_LIMIT = 200_000;

    private final ToolTraceMapper mapper;

    public ToolTraceService(ToolTraceMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 记一条工具调用。返回生成的 trace id。若 {@code resultText} 超 50K,截断并置
     * {@code truncated=true},库里 {@code bytesOriginal} 保留原长度供前端展示。
     */
    @Transactional
    public String record(String userId, RecordToolTraceRequest req) {
        String id = UUID.randomUUID().toString();

        String resultText = req.resultText();
        Integer bytesOriginal = null;
        boolean truncated = false;
        if (resultText != null && resultText.length() > RESULT_TEXT_LIMIT) {
            bytesOriginal = resultText.length();
            resultText = resultText.substring(0, RESULT_TEXT_LIMIT)
                    + "\n\n[...截断,原始 " + bytesOriginal + " 字符]";
            truncated = true;
            log.debug("truncate tool_trace result_text: tool={} orig={} kept={}",
                    req.toolName(), bytesOriginal, RESULT_TEXT_LIMIT);
        }

        String args = req.args();
        if (args != null && args.length() > ARGS_JSON_LIMIT) {
            // 极端情况才走这里,args 太大直接换成 {"__truncated": true, "original_len": N}
            log.warn("tool_trace args too large ({}), replacing with placeholder", args.length());
            args = "{\"__truncated\":true,\"original_len\":" + args.length() + "}";
        }

        String startedAt = req.startedAt() != null ? req.startedAt() : Instant.now().toString();
        String endedAt = req.endedAt();

        mapper.insert(id, userId, req.scope(), req.messageId(), req.subtaskId(),
                req.turnIndex(), req.callIndex(), req.toolCallId(), req.toolName(),
                args, req.result(), resultText, req.isError(), bytesOriginal, truncated,
                startedAt, endedAt);
        return id;
    }

    public Optional<ToolTraceRow> findById(String id) {
        return mapper.findById(id);
    }

    public List<ToolTraceRow> listByMessage(long messageId) {
        return mapper.listByMessage(messageId);
    }

    public List<ToolTraceRow> listBySubtask(String subtaskId) {
        return mapper.listBySubtask(subtaskId);
    }
}
