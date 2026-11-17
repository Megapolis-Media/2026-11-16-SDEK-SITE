declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CDEK_EDITOR_EMAILS?: string;
    CDEK_ADMIN_PASSWORD_HASH?: string;
    CDEK_SUPPORT_API_TOKEN?: string;
    CDEK_SUPPORT_HELPDESK_URL?: string;
    CDEK_SUPPORT_HELPDESK_TOKEN?: string;
    CDEK_SUPPORT_RESEND_KEY?: string;
    CDEK_SUPPORT_EMAIL_FROM?: string;
  }
}
