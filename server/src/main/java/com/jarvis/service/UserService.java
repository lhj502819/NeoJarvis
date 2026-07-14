package com.jarvis.service;

import com.jarvis.domain.User;
import com.jarvis.domain.UserRow;
import com.jarvis.mapper.UserMapper;
import com.jarvis.util.PasswordHasher;
import com.jarvis.web.BadRequestException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * User CRUD + password hashing. Ports src/auth/users.ts:
 * <ul>
 *   <li>duplicate username -> {@link BadRequestException} "用户名已存在"</li>
 *   <li>the very first registered user becomes {@code admin}, everyone else {@code user}</li>
 *   <li>password is PBKDF2-hashed via {@link PasswordHasher} with a per-user salt; the
 *       plaintext is never stored and never leaves this layer</li>
 *   <li>admins cannot be deleted</li>
 * </ul>
 */
@Service
public class UserService {

    private static final Logger log = LoggerFactory.getLogger(UserService.class);

    private final UserMapper userMapper;

    public UserService(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    @Transactional
    public UserRow createUser(String username, String displayName, String password) {
        if (userMapper.findRowByUsername(username).isPresent()) {
            throw new BadRequestException("用户名已存在");
        }
        String role = userMapper.count() == 0 ? "admin" : "user";
        String salt = PasswordHasher.generateSalt();
        UserRow user = new UserRow(
                UUID.randomUUID().toString(),
                username,
                displayName,
                PasswordHasher.hash(password, salt),
                salt,
                role,
                Instant.now().toString());
        userMapper.insert(user.id(), user.username(), user.displayName(), user.passwordHash(),
                user.salt(), user.role(), user.createdAt());
        log.info("create_user id={} username={} role={}", user.id(), username, role);
        return user;
    }

    @Transactional(readOnly = true)
    public Optional<UserRow> findByUsername(String username) {
        return userMapper.findRowByUsername(username);
    }

    @Transactional(readOnly = true)
    public Optional<UserRow> findById(String userId) {
        return userMapper.findRowById(userId);
    }

    /** Constant-time password check against the stored hash + salt. */
    public boolean validatePassword(UserRow user, String password) {
        return PasswordHasher.verify(password, user.salt(), user.passwordHash());
    }

    @Transactional(readOnly = true)
    public List<User> listUsers() {
        return userMapper.listSafe();
    }

    @Transactional(readOnly = true)
    public boolean isAdmin(String userId) {
        return userMapper.findRole(userId).map("admin"::equals).orElse(false);
    }

    /** Delete a user; false when missing, {@link BadRequestException} when it's an admin. */
    @Transactional
    public boolean deleteUser(String userId) {
        Optional<String> role = userMapper.findRole(userId);
        if (role.isEmpty()) {
            return false;
        }
        if ("admin".equals(role.get())) {
            throw new BadRequestException("不能删除管理员");
        }
        userMapper.delete(userId);
        log.info("delete_user id={}", userId);
        return true;
    }
}
