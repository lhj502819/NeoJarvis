package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.jarvis.domain.AgentConversation;
import com.jarvis.domain.AgentMessage;
import com.jarvis.domain.SubTaskRow;
import com.jarvis.domain.SubTaskTurn;
import com.jarvis.domain.SubtaskFullHistory;
import com.jarvis.domain.ToolTraceRow;
import com.jarvis.mapper.SubtaskMapper;
import com.jarvis.mapper.SubtaskTurnMapper;
import com.jarvis.mapper.ToolTraceMapper;
import com.jarvis.web.NotFoundException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

/**
 * SubtaskHistoryService 单测:重点验 comms 双线合并 + taskId 线过滤兄弟 subtask +
 * 按 timestamp 升序 + 404。mock 4 依赖。
 */
class SubtaskHistoryServiceTest {

    private SubtaskMapper subtaskMapper;
    private SubtaskTurnMapper turnMapper;
    private ToolTraceMapper toolTraceMapper;
    private AgentBusService agentBusService;
    private SubtaskHistoryService service;

    @BeforeEach
    void setUp() {
        subtaskMapper = Mockito.mock(SubtaskMapper.class);
        turnMapper = Mockito.mock(SubtaskTurnMapper.class);
        toolTraceMapper = Mockito.mock(ToolTraceMapper.class);
        agentBusService = Mockito.mock(AgentBusService.class);
        service = new SubtaskHistoryService(subtaskMapper, turnMapper, toolTraceMapper, agentBusService);
    }

    @Test
    void assemblesAllFourSourcesForSubtask() {
        // Given: subtask 行 + turns + traces + 两条空沟通
        when(subtaskMapper.findByIdAndUser("st-1", "u1")).thenReturn(Optional.of(subRow("st-1", "task-1", "数 md 文件")));
        when(turnMapper.listBySubtask("st-1")).thenReturn(List.of(turn("t1", "st-1", 1, "先看目录")));
        when(toolTraceMapper.listBySubtask("st-1")).thenReturn(List.of(trace("tr1", "st-1", "Bash")));
        when(agentBusService.getConversation("st-1")).thenReturn(Optional.empty());
        when(agentBusService.getConversation("task-1")).thenReturn(Optional.empty());

        // When
        SubtaskFullHistory h = service.getFullHistory("u1", "st-1");

        // Then
        assertThat(h.subtaskId()).isEqualTo("st-1");
        assertThat(h.taskId()).isEqualTo("task-1");
        assertThat(h.description()).isEqualTo("数 md 文件");
        assertThat(h.turns()).hasSize(1);
        assertThat(h.toolTraces()).hasSize(1);
        assertThat(h.comms()).isEmpty();
    }

    @Test
    void commsMergeBothThreadsFilterSiblingsAndSortByTimestamp() {
        when(subtaskMapper.findByIdAndUser("st-1", "u1")).thenReturn(Optional.of(subRow("st-1", "task-1", "d")));
        when(turnMapper.listBySubtask("st-1")).thenReturn(List.of());
        when(toolTraceMapper.listBySubtask("st-1")).thenReturn(List.of());

        // subtaskId 线:Jarvis→小弟打断(ts=2)
        when(agentBusService.getConversation("st-1")).thenReturn(Optional.of(conv("st-1", List.of(
                msg("m2", "jarvis", "st-1", "st-1", "2026-07-17T00:00:02Z")))));
        // taskId 线:本 subtask 的请示(ts=1) + 兄弟 subtask st-2 的请示(应被过滤)
        when(agentBusService.getConversation("task-1")).thenReturn(Optional.of(conv("task-1", List.of(
                msg("m1", "st-1", "jarvis", "task-1", "2026-07-17T00:00:01Z"),
                msg("m-sibling", "st-2", "jarvis", "task-1", "2026-07-17T00:00:03Z")))));

        SubtaskFullHistory h = service.getFullHistory("u1", "st-1");

        // Then: 只保留本 subtask 的 2 条,兄弟 st-2 被过滤,按 ts 升序 m1(1) → m2(2)
        assertThat(h.comms()).extracting(AgentMessage::id).containsExactly("m1", "m2");
    }

    @Test
    void notFoundWhenSubtaskMissing() {
        when(subtaskMapper.findByIdAndUser("nope", "u1")).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.getFullHistory("u1", "nope"))
                .isInstanceOf(NotFoundException.class);
    }

    @Test
    void tryGetReturnsEmptyInsteadOfThrowing() {
        when(subtaskMapper.findByIdAndUser("nope", "u1")).thenReturn(Optional.empty());
        assertThat(service.tryGetFullHistory("u1", "nope")).isEmpty();
    }

    // ─── fixtures ───

    private static SubTaskRow subRow(String id, String taskId, String desc) {
        return new SubTaskRow(id, taskId, "n", desc, "本地文件查询", "本地文件查询", null,
                "completed", null, "200", null, null, null, null, 1, 0, 2, 3, "c0", "u0");
    }

    private static SubTaskTurn turn(String id, String subtaskId, int idx, String text) {
        return new SubTaskTurn(id, subtaskId, idx, text, "s0", "e0", "c0");
    }

    private static ToolTraceRow trace(String id, String subtaskId, String toolName) {
        return new ToolTraceRow(id, "u1", "subtask", null, subtaskId, 1, 0, "toolu_x", toolName,
                "{}", null, "ok", false, null, false, "s0", "e0", "c0");
    }

    private static AgentConversation conv(String ctx, List<AgentMessage> msgs) {
        return new AgentConversation(ctx, List.of(), msgs, "c0", "u0");
    }

    private static AgentMessage msg(String id, String from, String to, String ctx, String ts) {
        return new AgentMessage(id, from, to, ctx, "user",
                List.of(Map.of("kind", "text", "text", "hi")), ts, Map.of());
    }
}
