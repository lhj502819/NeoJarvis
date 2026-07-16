package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.RecordToolTraceRequest;
import com.jarvis.domain.ToolTraceRow;
import com.jarvis.service.ToolTraceService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 工具调用完整历史 REST 端点。TS 采集点(llm.ts / a2a/client.ts)通过 POST 写入,
 * 前端 ExecutionModal(下一阶段)通过 GET 按需拉取。
 */
@RestController
@RequestMapping("/api")
class ToolTraceController {

    private final ToolTraceService service;

    ToolTraceController(ToolTraceService service) {
        this.service = service;
    }

    /** POST /api/tool-traces — 记一条工具调用(scope 决定归属)。返回生成的 id。 */
    @PostMapping("/tool-traces")
    IdResponse record(@RequestBody RecordToolTraceRequest req) {
        String id = service.record(UserContext.currentUserId(), req);
        return new IdResponse(id);
    }

    /** GET /api/tool-traces/{id} — 取一条完整原始(含 args/result JSON、未截断的 result_text)。 */
    @GetMapping("/tool-traces/{id}")
    ToolTraceRow findById(@PathVariable("id") String id) {
        return service.findById(id).orElseThrow(() -> new NotFoundException("tool trace not found: " + id));
    }

    /** GET /api/subtask/{subtaskId}/tool-traces — 子任务下所有工具调用(按 turn_index, call_index 升序)。 */
    @GetMapping("/subtask/{subtaskId}/tool-traces")
    List<ToolTraceRow> listBySubtask(@PathVariable("subtaskId") String subtaskId) {
        return service.listBySubtask(subtaskId);
    }

    /** GET /api/message/{messageId}/tool-traces — Jarvis 一条 assistant 消息下所有工具调用(按 call_index 升序)。 */
    @GetMapping("/message/{messageId}/tool-traces")
    List<ToolTraceRow> listByMessage(@PathVariable("messageId") long messageId) {
        return service.listByMessage(messageId);
    }

    record IdResponse(String id) {}
}
