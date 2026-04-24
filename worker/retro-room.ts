import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

export class RetroRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async sayHello(): Promise<string> {
    const result = this.ctx.storage.sql
      .exec("SELECT 'Hello from RetroRoom!' as greeting")
      .one();
    return result.greeting as string;
  }
}
