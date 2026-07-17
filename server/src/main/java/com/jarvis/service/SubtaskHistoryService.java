package com.jarvis.service;

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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 聚合一个子任务的完整执行历史(description + turns + toolTraces + comms),供 TS 侧
 * 组装成"上次记忆"注入下一个同类小弟的 prompt。替代 SDK resume 黑盒。
 *
 * <p><b>comms 双线合并</b>:同一次执行的 Jarvis 沟通被 A2A bus 拆到两个 contextId 线程 ——
 * 小弟→Jarvis 请示走 taskId 线(混有兄弟 subtask 的请示,需按 from/to==subtaskId 过滤),
 * Jarvis→小弟打断走 subtaskId 线。两条都拉、过滤、按 timestamp 升序合并。
 */
@Service
public class SubtaskHistoryService {

    private static final Logger log = LoggerFactory.getLogger(SubtaskHistoryService.class);

    private final SubtaskMapper subtaskMapper;
    private final SubtaskTurnMapper turnMapper;
    private final ToolTraceMapper toolTraceMapper;
    private final AgentBusService agentBusService;

    public SubtaskHistoryService(SubtaskMapper subtaskMapper, SubtaskTurnMapper turnMapper,
            ToolTraceMapper toolTraceMapper, AgentBusService agentBusService) {
        this.subtaskMapper = subtaskMapper;
        this.turnMapper = turnMapper;
        this.toolTraceMapper = toolTraceMapper;
        this.agentBusService = agentBusService;
    }

    /**
     * 组装子任务完整历史。subtask 不存在时抛 404。turns/toolTraces/comms 任一为空都正常
     * (老数据可能没有 traces),TS 侧据此决定拼多少。
     */
    @Transactional(readOnly = true)
    public SubtaskFullHistory getFullHistory(String userId, String subtaskId) {
        SubTaskRow sub = subtaskMapper.findByIdAndUser(subtaskId, userId)
                .orElseThrow(() -> new NotFoundException("subtask not found: " + subtaskId));

        List<SubTaskTurn> turns = turnMapper.listBySubtask(subtaskId);
        List<ToolTraceRow> toolTraces = toolTraceMapper.listBySubtask(subtaskId);
        List<AgentMessage> comms = mergeComms(sub.taskId(), subtaskId);

        log.debug("full_history subtaskId={} turns={} traces={} comms={}",
                subtaskId, turns.size(), toolTraces.size(), comms.size());

        return new SubtaskFullHistory(subtaskId, sub.taskId(), sub.description(),
                turns, toolTraces, comms);
    }

    /**
     * 合并两个 contextId 线程的 Jarvis 沟通,按本 subtask 过滤(消息的 from 或 to 命中
     * subtaskId),按 timestamp 升序。taskId 线里可能混有兄弟 subtask 的请示,过滤掉。
     */
    private List<AgentMessage> mergeComms(String taskId, String subtaskId) {
        List<AgentMessage> merged = new ArrayList<>();

        // subtaskId 线:Jarvis→小弟打断(bus.notify('jarvis', subtaskId, subtaskId, ...))
        agentBusService.getConversation(subtaskId).map(AgentConversation::messages)
                .ifPresent(merged::addAll);

        // taskId 线:小弟→Jarvis 请示 + Jarvis 回复(bus.send(subtaskId, 'jarvis', taskId, ...))
        // 混有同任务下兄弟 subtask 的请示,只留 from/to 命中本 subtask 的
        agentBusService.getConversation(taskId).map(AgentConversation::messages)
                .ifPresent(msgs -> msgs.stream()
                        .filter(m -> subtaskId.equals(m.from()) || subtaskId.equals(m.to()))
                        .forEach(merged::add));

        merged.sort(Comparator.comparing(AgentMessage::timestamp,
                Comparator.nullsLast(Comparator.naturalOrder())));
        return merged;
    }

    public Optional<SubtaskFullHistory> tryGetFullHistory(String userId, String subtaskId) {
        try {
            return Optional.of(getFullHistory(userId, subtaskId));
        } catch (NotFoundException e) {
            return Optional.empty();
        }
    }
}
