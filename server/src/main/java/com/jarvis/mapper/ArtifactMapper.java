package com.jarvis.mapper;

import com.jarvis.domain.ArtifactDetail;
import com.jarvis.domain.ArtifactSummary;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * Artifact reads. {@link #listSummaryByTask} (A2) populates {@code TaskDetail.artifacts};
 * A3 adds the public list ({@code GET /api/artifacts}) and detail ({@code GET
 * /api/artifact/{id}}) endpoints. Explicit AS aliases so mapping never relies on
 * SELECT * ordering (CRITICAL-1). MySQL {@code LIKE} is case-insensitive under the
 * default utf8mb4 collation — the TS {@code ILIKE} maps straight to {@code LIKE}.
 */
@Mapper
public interface ArtifactMapper {

    @Select("SELECT id, type, title, language, version, created_at AS createdAt "
            + "FROM jarvis_artifacts "
            + "WHERE task_id = #{taskId} AND user_id = #{userId} ORDER BY created_at ASC")
    List<ArtifactSummary> listSummaryByTask(@Param("taskId") String taskId,
            @Param("userId") String userId);

    /**
     * Filtered, paged summary list. {@code type}/{@code q} are optional (null skips the
     * clause). {@code q} matches title or content via a parameterized LIKE (no injection).
     * Ordered by COALESCE(updated_at, created_at) DESC to match the TS route.
     */
    @Select("""
            <script>
            SELECT id, type, title, language, version,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM jarvis_artifacts
            WHERE user_id = #{userId}
            <if test="type != null"> AND type = #{type} </if>
            <if test="q != null"> AND (title LIKE CONCAT('%', #{q}, '%')
                                       OR content LIKE CONCAT('%', #{q}, '%')) </if>
            ORDER BY COALESCE(updated_at, created_at) DESC
            LIMIT #{limit} OFFSET #{offset}
            </script>
            """)
    List<ArtifactSummary> list(@Param("userId") String userId, @Param("type") String type,
            @Param("q") String q, @Param("limit") int limit, @Param("offset") int offset);

    /** Total rows matching the same filter (drives the {@code total} field). */
    @Select("""
            <script>
            SELECT COUNT(*) FROM jarvis_artifacts
            WHERE user_id = #{userId}
            <if test="type != null"> AND type = #{type} </if>
            <if test="q != null"> AND (title LIKE CONCAT('%', #{q}, '%')
                                       OR content LIKE CONCAT('%', #{q}, '%')) </if>
            </script>
            """)
    long count(@Param("userId") String userId, @Param("type") String type, @Param("q") String q);

    @Select("SELECT id, type, title, content, language, version FROM jarvis_artifacts "
            + "WHERE id = #{id} AND user_id = #{userId}")
    Optional<ArtifactDetail> findDetailByIdAndUser(@Param("id") String id,
            @Param("userId") String userId);

    /**
     * In-place content update, version bumped by 1 and {@code updated_at} set to the given
     * epoch-millis (ports tools.ts update_artifact). {@code title} is optional — when null the
     * title clause is skipped so the stored title is preserved (mirrors the TS branch that only
     * updates title when supplied). Returns affected rows so the caller can detect a missing id.
     */
    @Update("""
            <script>
            UPDATE jarvis_artifacts
            SET content = #{content}, version = version + 1, updated_at = #{updatedAt}
            <if test="title != null"> , title = #{title} </if>
            WHERE id = #{id} AND user_id = #{userId}
            </script>
            """)
    int updateContent(@Param("id") String id, @Param("userId") String userId,
            @Param("content") String content, @Param("title") String title,
            @Param("updatedAt") long updatedAt);

    /**
     * Store a new artifact (ports the internal TS saveArtifact). {@code createdAt} is BIGINT
     * epoch-millis; {@code version} is left to the DB default (1) — the TS INSERT never set
     * it. {@code language}/{@code taskId} are nullable.
     */
    @Insert("INSERT INTO jarvis_artifacts "
            + "(id, user_id, type, title, content, language, created_at, task_id) "
            + "VALUES (#{id}, #{userId}, #{type}, #{title}, #{content}, #{language}, "
            + "#{createdAt}, #{taskId})")
    void insert(@Param("id") String id, @Param("userId") String userId,
            @Param("type") String type, @Param("title") String title,
            @Param("content") String content, @Param("language") String language,
            @Param("createdAt") long createdAt, @Param("taskId") String taskId);
}
