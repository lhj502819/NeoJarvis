package com.jarvis.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/**
 * 清空一个用户的"记忆"—— 对话 + 执行痕迹,保留团队小弟(recipes)、制品库、凭证、
 * MCP/技能配置。删除顺序由 {@link com.jarvis.service.MemoryResetService} 编排,须在一个
 * 事务内按序执行(见各方法上的顺序说明)。
 *
 * <p>级联关系:jarvis_subtasks 靠 FK 从 jarvis_tasks 级联删;jarvis_agent_messages 从
 * jarvis_agent_threads 级联删;user_jarvis_messages 从 user_jarvis_sessions 级联删。
 * 因此本 mapper 只需删父表 + 无 user_id 的 jarvis_subtask_turns(必须最先删)。
 */
@Mapper
public interface MemoryResetMapper {

    /** ① turns 无 user_id、无 FK,只有 subtask_id —— 必须在删 subtasks 之前按用户的 subtask 先删。 */
    @Delete("DELETE FROM jarvis_subtask_turns WHERE subtask_id IN "
            + "(SELECT id FROM jarvis_subtasks WHERE user_id = #{userId})")
    void deleteSubtaskTurns(@Param("userId") String userId);

    /** ② 删任务(级联清 jarvis_subtasks)。 */
    @Delete("DELETE FROM jarvis_tasks WHERE user_id = #{userId}")
    void deleteTasks(@Param("userId") String userId);

    /** ③ 删 A2A 沟通线程(级联清 jarvis_agent_messages)。 */
    @Delete("DELETE FROM jarvis_agent_threads WHERE user_id = #{userId}")
    void deleteAgentThreads(@Param("userId") String userId);

    /** ④ 删工具调用记录。 */
    @Delete("DELETE FROM jarvis_tool_traces WHERE user_id = #{userId}")
    void deleteToolTraces(@Param("userId") String userId);

    /** ⑤ 删聊天图片行(磁盘物理文件留二期)。 */
    @Delete("DELETE FROM jarvis_chat_images WHERE user_id = #{userId}")
    void deleteChatImages(@Param("userId") String userId);

    /** ⑥ 删小弟 SDK 会话。 */
    @Delete("DELETE FROM jarvis_claude_sessions WHERE user_id = #{userId}")
    void deleteClaudeSessions(@Param("userId") String userId);

    /** ⑦ 删 Jarvis 运行态(主键 user_id)。 */
    @Delete("DELETE FROM jarvis_state WHERE user_id = #{userId}")
    void deleteState(@Param("userId") String userId);

    /** ⑧ 删对话会话(级联清 user_jarvis_messages)。 */
    @Delete("DELETE FROM user_jarvis_sessions WHERE user_id = #{userId}")
    void deleteConversationSessions(@Param("userId") String userId);
}
