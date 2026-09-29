import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HTTP_HOST: z.string().default("127.0.0.1"),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  LOG_LEVEL: z.enum(["fatal","error","warn","info","debug","trace"]).default("info"),
  DATABASE_URL: z.string().min(1).optional(),
  META_APP_ID: z.string().min(1).default("1042452472116584"),
  META_APP_SECRET: z.string().min(1).optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(16).optional(),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0")
});

export type Environment = z.infer<typeof schema> & { HTTP_PORT_EFFECTIVE: number };

export function loadEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = schema.parse(input);
  if (parsed.NODE_ENV === "production") {
    for (const key of ["DATABASE_URL","META_APP_SECRET","META_WEBHOOK_VERIFY_TOKEN"] as const) {
      if (parsed[key] === undefined) throw new Error(key + " is required in production");
    }
  }
  return { ...parsed, HTTP_PORT_EFFECTIVE: parsed.HTTP_PORT ?? parsed.PORT ?? 3000 };
}
