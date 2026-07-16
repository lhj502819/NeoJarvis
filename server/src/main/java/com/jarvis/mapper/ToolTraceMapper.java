package com.jarvis.mapper;

import com.jarvis.domain.ToolTraceRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * 工具调用完整历史的持久化(表 {@code jarvis_tool_traces})。参考 {@code SubtaskTurnMapper}
 * 只用注解,不写 xml。PG JSONB 列写入时用 {@code #{args}::jsonb} 显式 cast,读出时
 * 用 {@code ::text} 转回字符串给 domain record(Java 内不 parse)。
 *
 * <p>注:{@code result} 列可能为 null(工具还没返回或写入 error 之前先入库),此处
 * SELECT 用 {@code COALESCE(result::text, NULL)} 保持 nullable。
 */
@Mapper
public interface ToolTraceMapper {

    /** 通用 SELECT 列列表(顺序对齐 ToolTraceRow 构造器)。 */
    String COLUMNS = "id, user_id AS userId, scope, message_id AS messageId, "
            + "subtask_id AS subtaskId, turn_index AS turnIndex, call_index AS callIndex, "
            + "tool_call_id AS toolCallId, tool_name AS toolName, "
            + "args::text AS args, result::text AS result, result_text AS resultText, "
            + "is_error AS isError, bytes_original AS bytesOriginal, truncated, "
            + "started_at::text AS startedAt, ended_at::text AS endedAt, "
            + "created_at::text AS createdAt ";

    @Insert("INSERT INTO jarvis_tool_traces "
            + "(id, user_id, scope, message_id, subtask_id, turn_index, call_index, "
            + "tool_call_id, tool_name, args, result, result_text, is_error, "
            + "bytes_original, truncated, started_at, ended_at) "
            + "VALUES (#{id}, #{userId}, #{scope}, #{messageId}, #{subtaskId}, "
            + "#{turnIndex}, #{callIndex}, #{toolCallId}, #{toolName}, "
            + "#{args}::jsonb, #{result}::jsonb, #{resultText}, #{isError}, "
            + "#{bytesOriginal}, #{truncated}, #{startedAt}::timestamptz, #{endedAt}::timestamptz)")
    void insert(@Param("id") String id, @Param("userId") String userId,
            @Param("scope") String scope, @Param("messageId") Long messageId,
            @Param("subtaskId") String subtaskId, @Param("turnIndex") Integer turnIndex,
            @Param("callIndex") int callIndex, @Param("toolCallId") String toolCallId,
            @Param("toolName") String toolName, @Param("args") String args,
            @Param("result") String result, @Param("resultText") String resultText,
            @Param("isError") boolean isError, @Param("bytesOriginal") Integer bytesOriginal,
            @Param("truncated") boolean truncated, @Param("startedAt") String startedAt,
            @Param("endedAt") String endedAt);

    @Select("SELECT " + COLUMNS + "FROM jarvis_tool_traces WHERE id = #{id}")
    Optional<ToolTraceRow> findById(@Param("id") String id);

    /** 一条 Jarvis assistant 消息挂的所有 tool traces(按 callIndex 升序)。 */
    @Select("SELECT " + COLUMNS
            + "FROM jarvis_tool_traces WHERE scope='jarvis' AND message_id = #{messageId} "
            + "ORDER BY call_index ASC")
    List<ToolTraceRow> listByMessage(@Param("messageId") long messageId);

    /** 一个子任务的所有 tool traces(按 turnIndex, callIndex 升序)。 */
    @Select("SELECT " + COLUMNS
            + "FROM jarvis_tool_traces WHERE scope='subtask' AND subtask_id = #{subtaskId} "
            + "ORDER BY turn_index ASC, call_index ASC")
    List<ToolTraceRow> listBySubtask(@Param("subtaskId") String subtaskId);
}
