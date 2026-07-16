package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.jarvis.domain.RecordToolTraceRequest;
import com.jarvis.mapper.ToolTraceMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.mockito.stubbing.Answer;

/**
 * ToolTraceService 单测:重点验 50K 截断策略,mock 掉 mapper 只看服务层行为。
 * 用 Answer 捕获 insert 的所有参数,便于断言 resultText/bytesOriginal/truncated 的关系。
 */
class ToolTraceServiceTest {

    private ToolTraceMapper mapper;
    private ToolTraceService service;
    private InsertCall lastInsert;

    @BeforeEach
    void setUp() {
        mapper = Mockito.mock(ToolTraceMapper.class);
        lastInsert = new InsertCall();

        Answer<Void> captureAnswer = inv -> {
            Object[] args = inv.getArguments();
            lastInsert.id = (String) args[0];
            lastInsert.userId = (String) args[1];
            lastInsert.scope = (String) args[2];
            lastInsert.messageId = (Long) args[3];
            lastInsert.subtaskId = (String) args[4];
            lastInsert.turnIndex = (Integer) args[5];
            lastInsert.callIndex = (int) args[6];
            lastInsert.toolCallId = (String) args[7];
            lastInsert.toolName = (String) args[8];
            lastInsert.args = (String) args[9];
            lastInsert.result = (String) args[10];
            lastInsert.resultText = (String) args[11];
            lastInsert.isError = (boolean) args[12];
            lastInsert.bytesOriginal = (Integer) args[13];
            lastInsert.truncated = (boolean) args[14];
            lastInsert.startedAt = (String) args[15];
            lastInsert.endedAt = (String) args[16];
            return null;
        };

        Mockito.doAnswer(captureAnswer).when(mapper).insert(
                Mockito.anyString(), Mockito.anyString(), Mockito.anyString(),
                Mockito.any(), Mockito.any(), Mockito.any(),
                Mockito.anyInt(), Mockito.anyString(), Mockito.anyString(),
                Mockito.any(), Mockito.any(), Mockito.any(),
                Mockito.anyBoolean(), Mockito.any(), Mockito.anyBoolean(),
                Mockito.anyString(), Mockito.any());

        service = new ToolTraceService(mapper);
    }

    @Test
    void shortResultTextGoesThroughUntouched() {
        RecordToolTraceRequest req = new RecordToolTraceRequest("subtask", null, "st-1", 1, 0,
                "toolu_1", "Bash", "{\"command\":\"ls\"}", "{\"stdout\":\"abc\"}", "abc",
                false, "2026-07-15T00:00:00Z", "2026-07-15T00:00:01Z");

        String id = service.record("u1", req);

        assertThat(id).isNotBlank();
        assertThat(lastInsert.resultText).isEqualTo("abc");
        assertThat(lastInsert.bytesOriginal).isNull();
        assertThat(lastInsert.truncated).isFalse();
        assertThat(lastInsert.userId).isEqualTo("u1");
        assertThat(lastInsert.subtaskId).isEqualTo("st-1");
        assertThat(lastInsert.messageId).isNull();
    }

    @Test
    void longResultTextGetsTruncatedAt50K() {
        // 60K 字符,超过 RESULT_TEXT_LIMIT=50000
        String huge = "x".repeat(60_000);
        RecordToolTraceRequest req = new RecordToolTraceRequest("subtask", null, "st-1", 1, 0,
                "toolu_1", "Bash", "{}", "{\"stdout\":\"...\"}", huge,
                false, "2026-07-15T00:00:00Z", "2026-07-15T00:00:01Z");

        service.record("u1", req);

        assertThat(lastInsert.resultText).startsWith("x".repeat(100));  // 保留了前缀
        assertThat(lastInsert.resultText).contains("[...截断,原始 60000 字符]");
        assertThat(lastInsert.bytesOriginal).isEqualTo(60000);
        assertThat(lastInsert.truncated).isTrue();
    }

    @Test
    void nullResultTextIsAcceptedAsIs() {
        // 工具尚未返回或错误状态下,resultText 可能是 null
        RecordToolTraceRequest req = new RecordToolTraceRequest("jarvis", 42L, null, null, 0,
                "toolu_a", "create_task", "{\"name\":\"t\"}", null, null,
                false, "2026-07-15T00:00:00Z", null);

        service.record("u1", req);

        assertThat(lastInsert.scope).isEqualTo("jarvis");
        assertThat(lastInsert.messageId).isEqualTo(42L);
        assertThat(lastInsert.resultText).isNull();
        assertThat(lastInsert.bytesOriginal).isNull();
        assertThat(lastInsert.truncated).isFalse();
    }

    @Test
    void oversizeArgsReplacedWithPlaceholder() {
        String hugeArgs = "{\"content\":\"" + "z".repeat(210_000) + "\"}";
        RecordToolTraceRequest req = new RecordToolTraceRequest("subtask", null, "st-1", 1, 0,
                "toolu_1", "Write", hugeArgs, "{}", "ok",
                false, "2026-07-15T00:00:00Z", "2026-07-15T00:00:01Z");

        service.record("u1", req);

        assertThat(lastInsert.args).contains("__truncated");
        assertThat(lastInsert.args).contains("\"original_len\":" + hugeArgs.length());
    }

    /** 结构化捕获 mapper.insert 的所有参数,便于按字段断言。 */
    private static class InsertCall {
        String id;
        String userId;
        String scope;
        Long messageId;
        String subtaskId;
        Integer turnIndex;
        int callIndex;
        String toolCallId;
        String toolName;
        String args;
        String result;
        String resultText;
        boolean isError;
        Integer bytesOriginal;
        boolean truncated;
        String startedAt;
        String endedAt;
    }
}
