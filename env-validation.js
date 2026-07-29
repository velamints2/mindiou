/**
 * 启动期环境变量验证（env-validation.js）
 *
 * 目标：配置错误在进程启动时给出明确信息，而不是在第一个请求时才暴露。
 *
 * 规则：
 * - 只报告变量名与问题，永远不打印任何变量值（防密钥泄露）。
 * - errors：值非法（无法安全运行），启动必须中止。
 * - warnings：值缺失或偏弱，进程可以继续（本地开发 / 降级模式）。
 * - MINDIOU_STRICT_ENV=1 时，warnings 升级为 errors（建议生产开启）。
 *
 * 该模块不读取任何文件、不发起网络请求，保持纯函数便于测试。
 */

const URL_ENV_NAMES = ["AI_BASE_URL", "RESEARCH_BASE_URL", "STT_BASE_URL", "OPENAI_BASE_URL"];
const NUMERIC_ENV_NAMES = [
  "PORT",
  "MINDIOU_SESSION_TTL_SECONDS",
  "OPENAI_CHAT_TIMEOUT_MS",
  "OPENAI_RESEARCH_TIMEOUT_MS",
  "STT_TIMEOUT_MS"
];

function has(env, name) {
  return Object.hasOwn(env, name) && String(env[name] || "").trim() !== "";
}

function firstConfigured(env, names) {
  return names.find(name => has(env, name)) || null;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {{ strict?: boolean }} [options]
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateEnv(env = process.env, options = {}) {
  const errors = [];
  const warnings = [];

  for (const name of NUMERIC_ENV_NAMES) {
    if (!has(env, name)) continue;
    const value = Number(env[name]);
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${name} 必须是正数，当前值无法解析（值已隐藏）。`);
    }
  }
  if (has(env, "PORT")) {
    const port = Number(env.PORT);
    if (Number.isFinite(port) && (port < 1 || port > 65535)) {
      errors.push("PORT 必须在 1-65535 之间。");
    }
  }
  for (const name of URL_ENV_NAMES) {
    if (!has(env, name)) continue;
    if (!isHttpUrl(String(env[name]).trim())) {
      errors.push(`${name} 必须是合法的 http(s) URL（值已隐藏）。`);
    }
  }

  const earlyAccessCodes = has(env, "MINDIOU_EARLY_ACCESS_CODES") || has(env, "MINDIOU_ACCESS_CODE");
  if (earlyAccessCodes && Buffer.byteLength(String(env.MINDIOU_SESSION_SECRET || "")) < 32) {
    errors.push(
      "配置了 MINDIOU_EARLY_ACCESS_CODES 但 MINDIOU_SESSION_SECRET 少于 32 字节；" +
      "邀请码登录会在请求时返回 503。请用 `openssl rand -hex 32` 生成。"
    );
  }
  if (!earlyAccessCodes && has(env, "MINDIOU_SESSION_SECRET")
      && Buffer.byteLength(String(env.MINDIOU_SESSION_SECRET)) < 32) {
    warnings.push("MINDIOU_SESSION_SECRET 少于 32 字节，建议用 `openssl rand -hex 32` 重新生成。");
  }

  const aiKeyName = firstConfigured(env, ["AI_API_KEY", "OPENAI_API_KEY"]);
  const aiDisabled = env.SPIRAL_DISABLE_AI === "1";
  if (!aiKeyName && !aiDisabled) {
    warnings.push(
      "未配置 AI_API_KEY（或旧别名 OPENAI_API_KEY）：文本生成将进入内置 fallback，" +
      "MVP-1 会话创建会被拒绝（除非 MVP1_DEMO_FALLBACK=1）。"
    );
  }
  if (aiKeyName && String(env[aiKeyName]).length < 16) {
    warnings.push(`${aiKeyName} 长度过短，疑似无效密钥（值已隐藏）。`);
  }

  if (!has(env, "RESEARCH_API_KEY") && env.RESEARCH_PROVIDER !== "openai" && has(env, "RESEARCH_PROVIDER")) {
    warnings.push(`RESEARCH_PROVIDER=${String(env.RESEARCH_PROVIDER)} 缺少对应 RESEARCH_API_KEY，联网检索不可用。`);
  }

  if (has(env, "LEARNING_API_TOKEN") && String(env.LEARNING_API_TOKEN).length < 16) {
    warnings.push("LEARNING_API_TOKEN 少于 16 字符，强度偏弱（值已隐藏）。");
  }

  const accessControlConfigured = has(env, "LEARNING_API_TOKEN") || earlyAccessCodes;
  if (!accessControlConfigured) {
    warnings.push(
      "未配置 LEARNING_API_TOKEN 或 MINDIOU_EARLY_ACCESS_CODES：管理通道对所有本地请求开放（仅适合本地开发）。"
    );
  }

  if (env.NODE_ENV === "production") {
    if (env.MINDIOU_COOKIE_SECURE !== "1") {
      warnings.push("生产环境 NODE_ENV=production 但 MINDIOU_COOKIE_SECURE 不是 1：会话 Cookie 缺少 Secure 标记。");
    }
    if (env.MVP1_DEMO_FALLBACK === "1") {
      warnings.push("生产环境启用了 MVP1_DEMO_FALLBACK=1：MVP-1 使用策展降级内容，请确认这是有意的演示配置。");
    }
  }

  if (options.strict && warnings.length) {
    return { errors: [...errors, ...warnings.map(w => `[strict] ${w}`)], warnings: [] };
  }
  return { errors, warnings };
}

/**
 * 在 server.js 启动早期调用。打印报告；存在 errors 时返回 false，由调用方退出。
 * 绝不打印变量值。
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{ warn?: (line: string) => void, error?: (line: string) => void }} [logger]
 * @returns {boolean} true 表示可以继续启动
 */
export function reportEnvValidation(env = process.env, logger = {}) {
  const warn = logger.warn || (line => console.warn(line));
  const error = logger.error || (line => console.error(line));
  const strict = env.MINDIOU_STRICT_ENV === "1";
  const result = validateEnv(env, { strict });
  for (const line of result.warnings) warn(`[env] 警告: ${line}`);
  if (!result.errors.length) return true;
  for (const line of result.errors) error(`[env] 错误: ${line}`);
  error("[env] 启动中止：请修正上述环境变量后重启（详见 docs/ops/CONFIGURATION_REFERENCE.md）。");
  return false;
}
