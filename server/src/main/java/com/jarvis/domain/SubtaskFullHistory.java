package com.jarvis.domain;

import java.util.List;

/**
 * 一个子任务的完整执行历史,供 TS 侧组装成"上次做类似任务的记忆"注入下一个同类小弟的
 * prompt(替代 SDK resume 黑盒)。聚合四个数据源:
 *
 * <ul>
 *   <li>{@code description} — 上次的任务描述(SubTaskRow.description)</li>
 *   <li>{@code turns} — 每回合的思考+工具名合成文本(jarvis_subtask_turns)</li>
 *   <li>{@code toolTraces} — 工具调用参数/返回(jarvis_tool_traces, scope='subtask')</li>
 *   <li>{@code comms} — 跟 Jarvis 的沟通(A2A bus 两个 contextId 线合并、按本 subtask 过滤)</li>
 * </ul>
 *
 * <p>comms 的合并逻辑见 SubtaskHistoryService:小弟→Jarvis 请示走 taskId 线程、
 * Jarvis→小弟打断走 subtaskId 线程,两条都拉、按 from/to==subtaskId 过滤、按 timestamp 排序。
 */
public record SubtaskFullHistory(
        String subtaskId,
        String taskId,
        String description,
        List<SubTaskTurn> turns,
        List<ToolTraceRow> toolTraces,
        List<AgentMessage> comms) {
}
