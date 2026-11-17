declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CDEK_EDITOR_EMAILS?: string;
    CDEK_ADMIN_PASSWORD_HASH?: string;
  }
}
