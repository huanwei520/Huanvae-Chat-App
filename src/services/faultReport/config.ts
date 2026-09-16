/**
 * 故障记录检测 —— 全局配置
 *
 * 【信封与加密】与服务器端（Huanvae-Chat-Rust examples/fault_report）约定的同一信封规范：
 *   envelope = { version:1, machine_code_hash, timestamp(秒), nonce(12B b64),
 *                ephemeral_public_key(32B b64), ciphertext(b64 密文||tag), app_version? }
 *   算法：X25519 ECDH → HKDF-SHA256 → ChaCha20-Poly1305（RFC 8439，AAD=派生盐，见 crypto.ts）
 *
 * 【正式公钥】✅ 已交付并内置。来源：/work/Huanvae-Chat-Rust
 *   `docs/diagnosis/fault-report/fault-report-public-key.pem`（服务器块一次性生成的
 *   X25519 正式密钥对之公钥，SPKI PEM 形态；标准路径 docs/fault-report-public-key.pem
 *   因其沙盒目录权限暂放该处，见服务器块交付说明）。
 *   私钥只在服务器侧（/vault.env 变量 FAULT_REPORT_PRIVATE_KEY 引用），绝不入仓、绝不入 App。
 *
 * 【联调旋钮】FAULT_REPORT_DEBUG_* 三个值仅在"全链路联调专用构建"中由构建期环境变量注入
 *   （VITE_FAULT_REPORT_DEBUG_PEM / VITE_FAULT_REPORT_DEBUG_ENDPOINT / VITE_FAULT_REPORT_DEBUG_TOKEN）。
 *   生产/常规构建这些变量未定义 → 恒为 null → 正式公钥/正式端点路径生效（旋钮为死代码被摇树）。
 *   用途仅限：本地起服务器块实例做端到端联调（指向 127.0.0.1 实例 + 联调专用临时密钥对/令牌）。
 *
 * @module services/faultReport/config
 */

/** 信封格式版本（整数 1，服务器 SUPPORTED_ENVELOPE_VERSIONS=[1]） */
export const FAULT_REPORT_ENVELOPE_VERSION = 1;

/** 上报端点（与服务器块约定：用户鉴权 POST /api/fault-reports，复用既有 client 鉴权） */
export const FAULT_REPORT_ENDPOINT = '/api/fault-reports';

/**
 * 内置正式公钥（PEM）。
 * 来源：/work/Huanvae-Chat-Rust docs/diagnosis/fault-report/fault-report-public-key.pem
 * （X25519 SPKI PEM；私钥绝不入仓不入 App）。
 */
export const FAULT_REPORT_PUBLIC_KEY_PEM: string =
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VuAyEApjl9/nIZXXerXsEvtaJ/j5NDecE7EQXF0gFP1UURZho=
-----END PUBLIC KEY-----`;

/** 联调专用公钥覆盖（构建期注入；null=用正式公钥） */
export const FAULT_REPORT_DEBUG_PEM: string | null =
  (import.meta.env.VITE_FAULT_REPORT_DEBUG_PEM as string | undefined) ?? null;

/** 联调专用端点覆盖（如 http://127.0.0.1:18099；null=走正式 /api/fault-reports） */
export const FAULT_REPORT_DEBUG_ENDPOINT: string | null =
  (import.meta.env.VITE_FAULT_REPORT_DEBUG_ENDPOINT as string | undefined) ?? null;

/** 联调专用 Bearer 令牌（指向本地实例的联调用户 JWT；null=用既有会话令牌） */
export const FAULT_REPORT_DEBUG_TOKEN: string | null =
  (import.meta.env.VITE_FAULT_REPORT_DEBUG_TOKEN as string | undefined) ?? null;

/** 生效公钥（联调覆盖 > 正式公钥） */
export function activeFaultPublicKeyPem(): string {
  return FAULT_REPORT_DEBUG_PEM ?? FAULT_REPORT_PUBLIC_KEY_PEM;
}

/** 环形缓冲字节上限：10MB，超限滚动丢弃最旧 */
export const FAULT_LOG_BUFFER_MAX_BYTES = 10 * 1024 * 1024;

/** 开启记录时自动附带开启前最近的日志窗口（毫秒） */
export const FAULT_LOG_PRE_WINDOW_MS = 5 * 60 * 1000;

/** 单次报告最多附带的截图张数 */
export const FAULT_REPORT_MAX_SCREENSHOTS = 5;

/** 截图压缩：最长边像素上限 */
export const FAULT_SCREENSHOT_MAX_EDGE_PX = 1280;

/** 截图压缩：JPEG 质量（0-1） */
export const FAULT_SCREENSHOT_JPEG_QUALITY = 0.75;

/** 本地暂存（上传失败）队列上限条数，超过丢弃最旧 */
export const FAULT_STAGING_MAX_ITEMS = 5;
