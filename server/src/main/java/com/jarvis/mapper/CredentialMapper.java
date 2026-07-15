package com.jarvis.mapper;

import com.jarvis.domain.Credential;
import com.jarvis.domain.CredentialRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * User BYOK credential access (ports src/auth/credentials.ts). {@link #listSafeByUser}
 * deliberately omits {@code api_key_enc} so the redacted key never leaves the DB layer;
 * {@link #findByIdAndUser} is internal and carries it for update/delete bookkeeping.
 * {@code is_default} is an INT 0/1 column mapped to a boolean by MyBatis.
 */
@Mapper
public interface CredentialMapper {

    /** Redacted list (NEVER selects api_key_enc), oldest first (mirrors TS). */
    @Select("SELECT id, user_id AS userId, label, tier, base_url AS baseUrl, model, "
            + "is_default AS isDefault, created_at AS createdAt, updated_at AS updatedAt "
            + "FROM jarvis_user_credentials WHERE user_id = #{userId} ORDER BY created_at ASC")
    List<Credential> listSafeByUser(@Param("userId") String userId);

    @Select("SELECT COUNT(*) FROM jarvis_user_credentials WHERE user_id = #{userId}")
    int countByUser(@Param("userId") String userId);

    /** Full row incl. encrypted key — internal only. */
    @Select("SELECT id, user_id AS userId, label, tier, api_key_enc AS apiKeyEnc, "
            + "base_url AS baseUrl, model, is_default AS isDefault, "
            + "created_at AS createdAt, updated_at AS updatedAt "
            + "FROM jarvis_user_credentials WHERE id = #{id} AND user_id = #{userId}")
    Optional<CredentialRow> findByIdAndUser(@Param("id") String id, @Param("userId") String userId);

    /**
     * Full row (incl. encrypted key) for the given tier: that tier's default first,
     * otherwise any of that tier — internal only, used by resolve.
     */
    @Select("SELECT id, user_id AS userId, label, tier, api_key_enc AS apiKeyEnc, "
            + "base_url AS baseUrl, model, is_default AS isDefault, "
            + "created_at AS createdAt, updated_at AS updatedAt "
            + "FROM jarvis_user_credentials WHERE user_id = #{userId} AND tier = #{tier} "
            + "ORDER BY is_default DESC, created_at ASC LIMIT 1")
    Optional<CredentialRow> findResolvableByTier(@Param("userId") String userId,
            @Param("tier") String tier);

    /**
     * Full row (incl. encrypted key) for the user's default credential (default first,
     * else earliest created) — internal only, used by resolve when no tier matches.
     */
    @Select("SELECT id, user_id AS userId, label, tier, api_key_enc AS apiKeyEnc, "
            + "base_url AS baseUrl, model, is_default AS isDefault, "
            + "created_at AS createdAt, updated_at AS updatedAt "
            + "FROM jarvis_user_credentials WHERE user_id = #{userId} "
            + "ORDER BY is_default DESC, created_at ASC LIMIT 1")
    Optional<CredentialRow> findResolvableDefault(@Param("userId") String userId);

    @Update("UPDATE jarvis_user_credentials SET is_default = 0 WHERE user_id = #{userId}")
    void clearDefault(@Param("userId") String userId);

    @Insert("INSERT INTO jarvis_user_credentials "
            + "(id, user_id, label, tier, api_key_enc, base_url, model, is_default, created_at, updated_at) "
            + "VALUES (#{id}, #{userId}, #{label}, #{tier}, #{apiKeyEnc}, #{baseUrl}, #{model}, "
            + "#{isDefault}, #{createdAt}, #{updatedAt})")
    void insert(@Param("id") String id, @Param("userId") String userId, @Param("label") String label,
            @Param("tier") String tier, @Param("apiKeyEnc") String apiKeyEnc,
            @Param("baseUrl") String baseUrl, @Param("model") String model,
            @Param("isDefault") int isDefault, @Param("createdAt") String createdAt,
            @Param("updatedAt") String updatedAt);

    @Update("UPDATE jarvis_user_credentials SET label = #{label}, tier = #{tier}, "
            + "api_key_enc = #{apiKeyEnc}, base_url = #{baseUrl}, model = #{model}, "
            + "is_default = #{isDefault}, updated_at = #{updatedAt} "
            + "WHERE id = #{id} AND user_id = #{userId}")
    void update(@Param("id") String id, @Param("userId") String userId, @Param("label") String label,
            @Param("tier") String tier, @Param("apiKeyEnc") String apiKeyEnc,
            @Param("baseUrl") String baseUrl, @Param("model") String model,
            @Param("isDefault") int isDefault, @Param("updatedAt") String updatedAt);

    @Delete("DELETE FROM jarvis_user_credentials WHERE id = #{id} AND user_id = #{userId}")
    void delete(@Param("id") String id, @Param("userId") String userId);

    /** Earliest-created credential id, used to reassign default after deleting one. */
    @Select("SELECT id FROM jarvis_user_credentials WHERE user_id = #{userId} "
            + "ORDER BY created_at ASC LIMIT 1")
    Optional<String> findEarliestId(@Param("userId") String userId);

    @Update("UPDATE jarvis_user_credentials SET is_default = 1 WHERE id = #{id} AND user_id = #{userId}")
    void setDefault(@Param("id") String id, @Param("userId") String userId);
}
