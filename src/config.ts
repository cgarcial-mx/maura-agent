import 'dotenv/config';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL ?? '',
  llm: {
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 8000),
    model: process.env.LLM_MODEL ?? '',
    apiKey: process.env.LLM_API_KEY ?? '',
    baseUrl: process.env.LLM_BASE_URL ?? '',
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN ?? '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
  },
  portability: {
    secret: process.env.PORTABILITY_SECRET ?? '',
    publicUrl: process.env.PUBLIC_URL ?? '',
  },
} as const;
