package com.jarvis.mapper;

import com.jarvis.domain.User;
import com.jarvis.domain.UserRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * {@code jarvis_users} access (ports src/auth/users.ts). Explicit column lists with
 * aliases (no {@code SELECT *}) so records bind by name. {@link #findRow*} carry the
 * password hash + salt for validation and are internal only; {@link #listSafe} omits them.
 */
@Mapper
public interface UserMapper {

    @Select("SELECT id, username, display_name AS displayName, password_hash AS passwordHash, "
            + "salt, role, created_at AS createdAt "
            + "FROM jarvis_users WHERE username = #{username}")
    Optional<UserRow> findRowByUsername(@Param("username") String username);

    @Select("SELECT id, username, display_name AS displayName, password_hash AS passwordHash, "
            + "salt, role, created_at AS createdAt "
            + "FROM jarvis_users WHERE id = #{id}")
    Optional<UserRow> findRowById(@Param("id") String id);

    @Select("SELECT COUNT(*) FROM jarvis_users")
    int count();

    @Select("SELECT role FROM jarvis_users WHERE id = #{id}")
    Optional<String> findRole(@Param("id") String id);

    /** Redacted list (never selects password_hash / salt), for admin listing. */
    @Select("SELECT id, username, display_name AS displayName, role, created_at AS createdAt "
            + "FROM jarvis_users ORDER BY created_at ASC")
    List<User> listSafe();

    @Insert("INSERT INTO jarvis_users "
            + "(id, username, display_name, password_hash, salt, role, created_at) "
            + "VALUES (#{id}, #{username}, #{displayName}, #{passwordHash}, #{salt}, #{role}, #{createdAt})")
    void insert(@Param("id") String id, @Param("username") String username,
            @Param("displayName") String displayName, @Param("passwordHash") String passwordHash,
            @Param("salt") String salt, @Param("role") String role,
            @Param("createdAt") String createdAt);

    @Delete("DELETE FROM jarvis_users WHERE id = #{id}")
    void delete(@Param("id") String id);
}
