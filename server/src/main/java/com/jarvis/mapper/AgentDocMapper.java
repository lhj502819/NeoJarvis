package com.jarvis.mapper;

import com.jarvis.domain.AgentDocRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * Generic document store (docs/superagent-design-v2.md P0). Owns every runtime state the TS
 * intelligence layer used to keep in JSON sidecar files: task/message origins, the jdsme
 * cursor, per-message chat timelines, comms logs — and later thread/trigger/subscription and
 * approval records. One row per (user_id, kind, doc_key); the bigserial id preserves insert
 * order so "newest first" listings read by {@code ORDER BY id DESC}.
 */
@Mapper
public interface AgentDocMapper {

    /** Explicit projection with AS aliases so record mapping never depends on SELECT * order. */
    String COLUMNS = "doc_key AS docKey, data::text AS data";

    @Select("SELECT " + COLUMNS + " FROM jarvis_agent_docs "
            + "WHERE user_id = #{userId} AND kind = #{kind} AND doc_key = #{docKey}")
    Optional<AgentDocRow> find(@Param("userId") String userId, @Param("kind") String kind,
            @Param("docKey") String docKey);

    /**
     * Documents of one kind, newest first, optionally narrowed by a doc_key prefix
     * (empty prefix = whole kind). Keys come from controlled namespaces (numeric ids,
     * fixed state keys), so LIKE wildcards in keys are not a concern.
     */
    @Select("SELECT " + COLUMNS + " FROM jarvis_agent_docs "
            + "WHERE user_id = #{userId} AND kind = #{kind} AND doc_key LIKE CONCAT(#{prefix}, '%') "
            + "ORDER BY id DESC LIMIT #{limit}")
    List<AgentDocRow> list(@Param("userId") String userId, @Param("kind") String kind,
            @Param("prefix") String prefix, @Param("limit") int limit);

    @Insert("INSERT INTO jarvis_agent_docs (user_id, kind, doc_key, data) "
            + "VALUES (#{userId}, #{kind}, #{docKey}, CAST(#{data} AS JSONB)) "
            + "ON CONFLICT (user_id, kind, doc_key) "
            + "DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()")
    void upsert(@Param("userId") String userId, @Param("kind") String kind,
            @Param("docKey") String docKey, @Param("data") String data);

    @Delete("DELETE FROM jarvis_agent_docs WHERE user_id = #{userId} AND kind = #{kind} AND doc_key = #{docKey}")
    int delete(@Param("userId") String userId, @Param("kind") String kind, @Param("docKey") String docKey);
}
